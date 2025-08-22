export const sync = (func: Function) => {
  const res = {
    data: null,
    error: null,
  }
  while (res.data === null && res.error === null) {
    func().then((res: any) => {
      res.data = res
    }).cactch((err: any) => {
      res.error = err
    })
  }
  return res;
}