import * as t from "@babel/types";
import { NodePath } from "@babel/core";

export type Annotation = "locked" | "useEffect";

export function getAnnotations(node: t.Node): Annotation[] {
  const { leadingComments } = node;
  return leadingComments
    ? leadingComments.reduce((array, { value }) => {
        const matches = value.match(/\s*@vidact-(\w+)/);
        if (matches) {
          return [...array, matches[1]];
        }

        return array;
      }, [])
    : [];
}

export function hasAnnotation(node: t.Node, annotation: Annotation) {
  return getAnnotations(node).includes(annotation);
}

export function annotate(path: NodePath, annotation: Annotation) {
  path.addComment("leading", " @vidact-" + annotation, true);
}
