import * as t from "@babel/types";

export function getLeftMostMemberExpression(
  memberExpression: t.MemberExpression
): t.MemberExpression {
  const object = memberExpression.object;
  if (t.isMemberExpression(object)) {
    return getLeftMostMemberExpression(object);
  }

  return memberExpression;
}
