function consolidateExecuters(executers) {
  return () => executers.forEach(executer => executer());
}
