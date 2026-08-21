use std::collections::BTreeMap;

use crate::{
    Diagnostic, DiagnosticCode, OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter, SourceId, SourceKind, UpdaterKind},
    ir::{ComponentIr, IrUpdater, lower_component},
    oxc_react::{
        identifier, is_identifier_continue, jsx_attribute_name, jsx_opening_tag_end,
        simple_const_bindings,
    },
};

/// Emits the deliberately narrow executable module used by the browser spike.
///
/// React Compiler supplies the dependency graph and updater order. This emitter
/// currently accepts one numeric `useState`, numeric `const` derivations, one
/// intrinsic root element, expression attributes, one text expression, and an
/// optional inline click handler. Anything outside that subset fails closed.
pub fn compile_spike_browser_module(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    let mut components = OxcReactAnalysisAdapter.analyze(input)?;
    let facts = components.pop().ok_or_else(|| {
        vec![unsupported(
            "React Compiler produced no component for browser codegen",
        )]
    })?;
    let ir = lower_component(facts).map_err(|diagnostic| vec![diagnostic])?;
    emit_module(input.source, &ir).map_err(|diagnostic| vec![diagnostic])
}

#[derive(Debug)]
struct StateBinding<'a> {
    value: &'a str,
    setter: &'a str,
    initial: &'a str,
}

#[derive(Debug)]
struct RootElement<'a> {
    tag: &'a str,
    attributes: BTreeMap<&'a str, &'a str>,
    text: &'a str,
}

fn emit_module(source: &str, ir: &ComponentIr) -> Result<String, Diagnostic> {
    let state = state_binding(source)?;
    if state.initial.parse::<f64>().is_err() {
        return Err(unsupported(
            "the browser spike currently requires a numeric useState initializer",
        ));
    }
    let root = root_element(source)?;
    let derivations = simple_const_expressions(source);
    let state_source = ir
        .sources
        .iter()
        .find(|source| source.kind == SourceKind::State && source.name == state.value)
        .ok_or_else(|| unsupported("the emitted state binding is absent from analysis facts"))?;
    if ir
        .sources
        .iter()
        .filter(|source| source.kind == SourceKind::State)
        .count()
        != 1
    {
        return Err(unsupported(
            "the browser spike currently supports exactly one state binding",
        ));
    }

    let needs_combined_mask = ir
        .updaters
        .iter()
        .any(|updater| updater.reads.len() != 1 || updater.writes.len() > 1);
    let combined_mask_import = if needs_combined_mask {
        "combineSources, "
    } else {
        ""
    };
    let mut output = format!(
        "import {{ {combined_mask_import}createStateSlot, createUpdaterScope, source, type StaticUpdater }} from '@vidact/runtime'\n\n"
    );
    output.push_str(&format!(
        "export function mount{}(host: ParentNode) {{\n",
        ir.name
    ));
    output.push_str(&format!(
        "  const element = document.createElement('{}')\n  const text = document.createTextNode('')\n  element.append(text)\n  const trace: string[] = []\n",
        root.tag
    ));
    output.push_str(&format!(
        "  let {}!: ReturnType<typeof createStateSlot<number>>\n",
        state.value
    ));
    for source in ir
        .sources
        .iter()
        .filter(|source| source.kind == SourceKind::Derived)
    {
        output.push_str(&format!("  let {}!: number\n", source.name));
    }
    output.push_str("  const updaters: StaticUpdater[] = [\n");
    for updater in &ir.updaters {
        output.push_str(&emit_updater(updater, ir, &state, &root, &derivations)?);
    }
    output.push_str("  ]\n  const scope = createUpdaterScope(updaters)\n");
    output.push_str(&format!(
        "  {} = createStateSlot(scope, source({}), {})\n",
        state.value,
        state_source.id.get(),
        state.initial
    ));
    output.push_str("  for (const updater of updaters) updater.run()\n  trace.length = 0\n");

    if let Some(handler) = root.attributes.get("onClick") {
        if !contains_identifier(handler, state.setter) {
            return Err(unsupported(
                "the browser spike click handler must call its state setter",
            ));
        }
        let handler = rewrite_expression(handler, &state)?;
        output.push_str(&format!(
            "  const handleClick = {handler}\n  element.addEventListener('click', handleClick)\n"
        ));
        output.push_str("  const dispose = () => {\n    element.removeEventListener('click', handleClick)\n    scope.dispose()\n  }\n");
    } else {
        output.push_str("  const dispose = scope.dispose\n");
    }
    output.push_str("  host.append(element)\n");
    output.push_str(&format!(
        "  return {{ element, {}: {}.set, batch: scope.batch, trace, dispose }}\n}}\n",
        state.setter, state.value
    ));
    Ok(output)
}

fn emit_updater(
    updater: &IrUpdater,
    ir: &ComponentIr,
    state: &StateBinding<'_>,
    root: &RootElement<'_>,
    derivations: &BTreeMap<String, &str>,
) -> Result<String, Diagnostic> {
    let reads = mask(&updater.reads);
    let writes = (!updater.writes.is_empty()).then(|| mask(&updater.writes));
    let (label, operation) = match &updater.kind {
        UpdaterKind::Derived => {
            let [write] = updater.writes.as_slice() else {
                return Err(unsupported(
                    "a derived updater must write exactly one source",
                ));
            };
            let name = source_name(ir, *write)?;
            let expression = derivations.get(name).ok_or_else(|| {
                unsupported(format!(
                    "missing source expression for derived binding {name}"
                ))
            })?;
            (
                format!("derived:{name}"),
                format!("{name} = {}", rewrite_expression(expression, state)?),
            )
        }
        UpdaterKind::Attribute { name } => {
            let expression = root.attributes.get(name.as_str()).ok_or_else(|| {
                unsupported(format!("missing JSX expression for attribute {name}"))
            })?;
            (
                format!("attribute:{name}"),
                format!(
                    "element.setAttribute('{name}', String({}))",
                    rewrite_expression(expression, state)?
                ),
            )
        }
        UpdaterKind::Text => (
            "text".into(),
            format!(
                "text.data = String({})",
                rewrite_expression(root.text, state)?
            ),
        ),
        kind => {
            return Err(unsupported(format!(
                "the browser spike cannot emit updater kind {kind:?}"
            )));
        }
    };
    let writes = writes.map_or(String::new(), |writes| format!(", writes: {writes}"));
    Ok(format!(
        "    {{ reads: {reads}{writes}, run: () => {{ trace.push('{label}'); {operation} }} }},\n"
    ))
}

fn source_name(ir: &ComponentIr, id: SourceId) -> Result<&str, Diagnostic> {
    ir.sources
        .iter()
        .find(|source| source.id == id)
        .map(|source| source.name.as_str())
        .ok_or_else(|| unsupported(format!("updater references unknown source {}", id.get())))
}

fn mask(ids: &[SourceId]) -> String {
    let sources = ids
        .iter()
        .map(|id| format!("source({})", id.get()))
        .collect::<Vec<_>>();
    match sources.as_slice() {
        [source] => source.clone(),
        _ => format!("combineSources({})", sources.join(", ")),
    }
}

fn state_binding(source: &str) -> Result<StateBinding<'_>, Diagnostic> {
    let bindings = source
        .split("const [")
        .skip(1)
        .filter_map(|tail| {
            let (bindings, remainder) = tail.split_once(']')?;
            let initializer = remainder.split(';').next().unwrap_or(remainder);
            let use_state = initializer.find("useState(")?;
            let values = bindings.split(',').map(str::trim).collect::<Vec<_>>();
            let [value, setter] = values.as_slice() else {
                return None;
            };
            let initial = &initializer[use_state + "useState(".len()..];
            let initial = initial.rsplit_once(')')?.0.trim();
            Some(StateBinding {
                value,
                setter,
                initial,
            })
        })
        .collect::<Vec<_>>();
    let [binding] = bindings.as_slice() else {
        return Err(unsupported(
            "the browser spike requires exactly one const [value, setter] = useState(...) binding",
        ));
    };
    Ok(StateBinding {
        value: binding.value,
        setter: binding.setter,
        initial: binding.initial,
    })
}

fn simple_const_expressions(source: &str) -> BTreeMap<String, &str> {
    simple_const_bindings(source).into_iter().collect()
}

fn root_element(source: &str) -> Result<RootElement<'_>, Diagnostic> {
    let jsx = source
        .split_once("return")
        .map(|(_, jsx)| jsx)
        .ok_or_else(|| unsupported("component has no return expression"))?;
    let open = jsx
        .find('<')
        .ok_or_else(|| unsupported("component does not return an intrinsic JSX element"))?;
    let jsx = &jsx[open + 1..];
    let tag = identifier(jsx).ok_or_else(|| unsupported("invalid intrinsic JSX tag"))?;
    if tag.chars().next().is_some_and(char::is_uppercase) {
        return Err(unsupported(
            "the browser spike does not emit component JSX elements",
        ));
    }
    let opening_end =
        jsx_opening_tag_end(jsx).ok_or_else(|| unsupported("unterminated JSX opening element"))?;
    let opening = &jsx[tag.len()..opening_end];
    let attributes = braced_attributes(opening)?;
    let children = &jsx[opening_end + 1..];
    let closing = format!("</{tag}");
    let children = children
        .split_once(&closing)
        .map(|(children, _)| children)
        .ok_or_else(|| unsupported("the browser spike requires an explicit closing tag"))?;
    let text = single_braced_child_expression(children)?;
    Ok(RootElement {
        tag,
        attributes,
        text,
    })
}

fn braced_attributes(source: &str) -> Result<BTreeMap<&str, &str>, Diagnostic> {
    let mut attributes = BTreeMap::new();
    let mut offset = 0;
    while offset < source.len() {
        offset += source[offset..]
            .find(|character: char| !character.is_whitespace())
            .unwrap_or(source.len() - offset);
        if offset == source.len() {
            break;
        }
        let name_end = offset
            + source[offset..]
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '=' | '{' | '}')
                })
                .unwrap_or(source.len() - offset);
        let name = jsx_attribute_name(&source[offset..name_end])
            .ok_or_else(|| unsupported("invalid JSX expression attribute"))?;
        offset = name_end
            + source[name_end..]
                .find(|character: char| !character.is_whitespace())
                .unwrap_or(source.len() - name_end);
        if !source[offset..].starts_with("={") {
            return Err(unsupported(format!(
                "the browser spike requires expression syntax for attribute {name}"
            )));
        }
        let open = offset + 1;
        let close = matching_brace(source, open)
            .ok_or_else(|| unsupported(format!("unterminated JSX attribute {name}")))?;
        attributes.insert(name, source[open + 1..close].trim());
        offset = close + 1;
    }
    Ok(attributes)
}

fn single_braced_child_expression(source: &str) -> Result<&str, Diagnostic> {
    let source = source.trim();
    if !source.starts_with('{') {
        return Err(unsupported(
            "the browser spike requires exactly one JSX child expression and no static text",
        ));
    }
    let close = matching_brace(source, 0)
        .ok_or_else(|| unsupported("unterminated JSX child expression"))?;
    if !source[close + 1..].trim().is_empty() {
        return Err(unsupported(
            "the browser spike requires exactly one JSX child expression and no static text",
        ));
    }
    Ok(source[1..close].trim())
}

fn matching_brace(source: &str, open: usize) -> Option<usize> {
    let mut depth = 0_u32;
    for (relative, character) in source[open..].char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(open + relative);
                }
            }
            _ => {}
        }
    }
    None
}

fn rewrite_expression(expression: &str, state: &StateBinding<'_>) -> Result<String, Diagnostic> {
    if expression.contains(['\'', '"', '`']) {
        return Err(unsupported(
            "the browser spike does not rewrite expressions containing string literals",
        ));
    }
    let expression = replace_identifier(expression, state.value, &format!("{}.get()", state.value));
    Ok(replace_identifier(
        &expression,
        state.setter,
        &format!("{}.set", state.value),
    ))
}

fn replace_identifier(source: &str, name: &str, replacement: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut offset = 0;
    for (index, _) in source.match_indices(name) {
        let before = source[..index].chars().next_back();
        let after = source[index + name.len()..].chars().next();
        if before.is_some_and(is_identifier_continue) || after.is_some_and(is_identifier_continue) {
            continue;
        }
        output.push_str(&source[offset..index]);
        output.push_str(replacement);
        offset = index + name.len();
    }
    output.push_str(&source[offset..]);
    output
}

fn contains_identifier(source: &str, name: &str) -> bool {
    source.match_indices(name).any(|(start, _)| {
        let before = source[..start].chars().next_back();
        let after = source[start + name.len()..].chars().next();
        !before.is_some_and(is_identifier_continue) && !after.is_some_and(is_identifier_continue)
    })
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}
