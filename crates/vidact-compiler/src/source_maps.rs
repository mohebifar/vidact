use oxc_sourcemap::{OwnedSourceMap, SourceMap, SourceMapBuilder};

use crate::{Diagnostic, SourceSpan};

pub(crate) fn compose(generated: &SourceMap<'_>, original: &SourceMap<'_>) -> OwnedSourceMap {
    let lookup = original.generate_lookup_table();
    let mut builder = SourceMapBuilder::default();
    if let Some(file) = generated.get_file() {
        builder.set_file(file);
    }

    for token in generated.get_source_view_tokens() {
        let mapped = original.lookup_source_view_token_approx(
            &lookup,
            token.get_src_line(),
            token.get_src_col(),
        );
        let Some(mapped) = mapped else {
            let name_id = token.get_name().map(|name| builder.add_name(name));
            builder.add_token(
                token.get_dst_line(),
                token.get_dst_col(),
                token.get_src_line(),
                token.get_src_col(),
                None,
                name_id,
            );
            continue;
        };
        let source_id = mapped.get_source().map(|source| {
            builder.add_source_and_content(source, mapped.get_source_content().unwrap_or(""))
        });
        let name_id = token
            .get_name()
            .or_else(|| mapped.get_name())
            .map(|name| builder.add_name(name));
        builder.add_token(
            token.get_dst_line(),
            token.get_dst_col(),
            mapped.get_src_line(),
            mapped.get_src_col(),
            source_id,
            name_id,
        );
    }

    builder.into_owned_sourcemap()
}

pub(crate) fn compose_chain(
    mut generated: OwnedSourceMap,
    originals: impl DoubleEndedIterator<Item = OwnedSourceMap>,
) -> OwnedSourceMap {
    for original in originals.rev() {
        generated = compose(generated.as_source_map(), original.as_source_map());
    }
    generated
}

pub(crate) fn remap_diagnostics(
    diagnostics: &mut [Diagnostic],
    sources: &[String],
    maps: &[OwnedSourceMap],
) {
    debug_assert_eq!(sources.len(), maps.len() + 1);
    for diagnostic in diagnostics {
        let Some(mut span) = diagnostic.span else {
            continue;
        };
        for index in (0..maps.len()).rev() {
            span = remap_span(
                span,
                &sources[index + 1],
                &sources[index],
                maps[index].as_source_map(),
            );
        }
        diagnostic.span = Some(span);
    }
}

fn remap_span(
    span: SourceSpan,
    generated_source: &str,
    original_source: &str,
    source_map: &SourceMap<'_>,
) -> SourceSpan {
    let start = remap_offset(span.start, generated_source, original_source, source_map)
        .unwrap_or(span.start);
    let length_end = start
        .saturating_add(span.end.saturating_sub(span.start))
        .min(u32::try_from(original_source.len()).unwrap_or(u32::MAX));
    let end = remap_offset(span.end, generated_source, original_source, source_map)
        .filter(|end| *end >= start)
        .map_or(length_end, |end| end.max(length_end));
    SourceSpan::new(start, end)
}

fn remap_offset(
    offset: u32,
    generated_source: &str,
    original_source: &str,
    source_map: &SourceMap<'_>,
) -> Option<u32> {
    let (line, column) = line_column_for_offset(generated_source, offset)?;
    let lookup = source_map.generate_lookup_table();
    let token = source_map.lookup_source_view_token_approx(&lookup, line, column)?;
    offset_for_line_column(original_source, token.get_src_line(), token.get_src_col())
}

fn line_column_for_offset(source: &str, offset: u32) -> Option<(u32, u32)> {
    let offset = usize::try_from(offset).ok()?.min(source.len());
    let prefix = source.get(..offset)?;
    let line = u32::try_from(prefix.bytes().filter(|byte| *byte == b'\n').count()).ok()?;
    let column = u32::try_from(
        prefix
            .rsplit_once('\n')
            .map_or(prefix, |(_, line)| line)
            .len(),
    )
    .ok()?;
    Some((line, column))
}

fn offset_for_line_column(source: &str, line: u32, column: u32) -> Option<u32> {
    let mut offset = 0_usize;
    let line = usize::try_from(line).ok()?;
    for current in 0..line {
        let remainder = source.get(offset..)?;
        let newline = remainder.find('\n')?;
        offset = offset.checked_add(newline + 1)?;
        debug_assert!(current < line);
    }
    let line_end = source
        .get(offset..)?
        .find('\n')
        .map_or(source.len(), |newline| offset + newline);
    let column = usize::try_from(column).ok()?;
    u32::try_from(offset + column.min(line_end.saturating_sub(offset))).ok()
}

#[cfg(test)]
mod tests {
    use oxc_sourcemap::SourceMapBuilder;

    use crate::{Diagnostic, DiagnosticCode, SourceSpan};

    use super::{compose, remap_diagnostics};

    #[test]
    fn composes_generated_positions_through_an_intermediate_map() {
        let mut original = SourceMapBuilder::default();
        let original_source = original.add_source_and_content("original.tsx", "source");
        original.add_token(4, 2, 8, 6, Some(original_source), None);
        let original = original.into_sourcemap();

        let mut generated = SourceMapBuilder::default();
        let intermediate = generated.add_source_and_content("intermediate.js", "generated");
        generated.add_token(1, 3, 4, 2, Some(intermediate), None);
        let generated = generated.into_sourcemap();

        let composed = compose(&generated, &original);
        let token = composed.get_source_view_token(0).expect("composed token");
        assert_eq!(token.get_dst_line(), 1);
        assert_eq!(token.get_dst_col(), 3);
        assert_eq!(token.get_source(), Some("original.tsx"));
        assert_eq!(token.get_src_line(), 8);
        assert_eq!(token.get_src_col(), 6);
    }

    #[test]
    fn remaps_diagnostic_spans_through_canonical_sources() {
        let original_source = "first\noriginal_call()\n".to_string();
        let canonical_source = "first;\nnormalized_call();\n".to_string();
        let mut map = SourceMapBuilder::default();
        let source = map.add_source_and_content("original.tsx", &original_source);
        map.add_token(1, 0, 1, 0, Some(source), None);
        let map = map.into_owned_sourcemap();
        let mut diagnostics = [
            Diagnostic::new(DiagnosticCode::UnsupportedSyntax, "unsupported")
                .with_span(SourceSpan::new(7, 22)),
        ];

        remap_diagnostics(
            &mut diagnostics,
            &[original_source, canonical_source],
            &[map],
        );

        assert_eq!(diagnostics[0].span.map(|span| span.start), Some(6));
    }
}
