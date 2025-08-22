import store from "./store"
export default function test() {
  const { count } = store();
  console.log("test:", count);

}