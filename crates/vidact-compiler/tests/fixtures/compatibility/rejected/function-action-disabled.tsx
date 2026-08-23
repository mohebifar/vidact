export function DisabledFormAction() {
  const submit = async (_data: FormData) => {}
  return <form action={submit}><button>save</button></form>
}
