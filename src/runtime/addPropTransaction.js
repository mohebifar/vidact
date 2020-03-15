export function addPropTransaction(transactionContainer, instance, key, value) {
  transactionContainer.set(instance, {
    ...(transactionContainer.get(instance) || {}),
    [key]: value
  });
}
