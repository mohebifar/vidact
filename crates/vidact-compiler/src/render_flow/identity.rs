use crate::SourceSpan;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenderIdentityKey {
    Absent,
    Static(String),
    Dynamic(SourceSpan),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenderIdentityKind {
    Empty,
    Scalar,
    Host(String),
    Component(String),
    Fragment,
    Array,
    Dynamic,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderIdentity {
    pub kind: RenderIdentityKind,
    pub key: RenderIdentityKey,
    pub children: Vec<RenderIdentity>,
}

impl RenderIdentity {
    #[must_use]
    pub fn leaf(kind: RenderIdentityKind) -> Self {
        Self {
            kind,
            key: RenderIdentityKey::Absent,
            children: vec![],
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderAlignmentKind {
    Preserve,
    Replace,
    Dispatch,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderAlignment {
    pub kind: RenderAlignmentKind,
    pub children: Vec<RenderAlignment>,
}

#[must_use]
pub fn align_render_identities(left: &RenderIdentity, right: &RenderIdentity) -> RenderAlignment {
    let key_alignment = align_keys(&left.key, &right.key);
    if key_alignment != RenderAlignmentKind::Preserve {
        return RenderAlignment {
            kind: key_alignment,
            children: vec![],
        };
    }

    let kind = match (&left.kind, &right.kind) {
        (RenderIdentityKind::Dynamic, _) | (_, RenderIdentityKind::Dynamic) => {
            RenderAlignmentKind::Dispatch
        }
        (RenderIdentityKind::Host(left), RenderIdentityKind::Host(right))
        | (RenderIdentityKind::Component(left), RenderIdentityKind::Component(right))
            if left == right =>
        {
            RenderAlignmentKind::Preserve
        }
        (RenderIdentityKind::Fragment, RenderIdentityKind::Fragment)
        | (RenderIdentityKind::Array, RenderIdentityKind::Array)
        | (RenderIdentityKind::Scalar, RenderIdentityKind::Scalar)
        | (RenderIdentityKind::Empty, RenderIdentityKind::Empty) => RenderAlignmentKind::Preserve,
        _ => RenderAlignmentKind::Replace,
    };
    if kind != RenderAlignmentKind::Preserve {
        return RenderAlignment {
            kind,
            children: vec![],
        };
    }

    let align_children = matches!(
        (&left.kind, &right.kind),
        (RenderIdentityKind::Host(_), RenderIdentityKind::Host(_))
            | (RenderIdentityKind::Fragment, RenderIdentityKind::Fragment)
            | (RenderIdentityKind::Array, RenderIdentityKind::Array)
    );
    let children = if align_children {
        let count = left.children.len().max(right.children.len());
        (0..count)
            .map(
                |index| match (left.children.get(index), right.children.get(index)) {
                    (Some(left), Some(right)) => align_render_identities(left, right),
                    _ => RenderAlignment {
                        kind: RenderAlignmentKind::Replace,
                        children: vec![],
                    },
                },
            )
            .collect()
    } else {
        vec![]
    };
    RenderAlignment { kind, children }
}

fn align_keys(left: &RenderIdentityKey, right: &RenderIdentityKey) -> RenderAlignmentKind {
    match (left, right) {
        (RenderIdentityKey::Absent, RenderIdentityKey::Absent) => RenderAlignmentKind::Preserve,
        (RenderIdentityKey::Static(left), RenderIdentityKey::Static(right)) if left == right => {
            RenderAlignmentKind::Preserve
        }
        (RenderIdentityKey::Dynamic(_), _) | (_, RenderIdentityKey::Dynamic(_)) => {
            RenderAlignmentKind::Dispatch
        }
        _ => RenderAlignmentKind::Replace,
    }
}
