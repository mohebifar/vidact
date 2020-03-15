import {
  ELEMENT_VAR,
  ELEMENT_UPDATER_SUFFIX,
  STATEMENT_EXECUTER_VAR
} from "../constants";

const elementVarRegex = new RegExp(`^_${ELEMENT_VAR}\\d*$`);
const statementExecuterVarRegex = new RegExp(
  `^_${STATEMENT_EXECUTER_VAR}\\d*$`
);
const elementInstanceVarRegex = new RegExp(`^_${ELEMENT_VAR}\\d*_instance$`);
const elementUpdateVarRegex = new RegExp(
  `^_${ELEMENT_VAR}\\d*${ELEMENT_UPDATER_SUFFIX}$`
);

export function isElementVar(name: string) {
  return elementVarRegex.test(name) || elementInstanceVarRegex.test(name);
}

export function isElementUpdate(name: string) {
  return elementUpdateVarRegex.test(name);
}

export function isStatementExecuter(name: string) {
  return statementExecuterVarRegex.test(name);
}
