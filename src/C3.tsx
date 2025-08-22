import React from "react";
import withStore, { StoreProps } from "./withStore";

class C3 extends React.Component<StoreProps> {

  render(): React.ReactNode {
    const { count } = this.props.store;
    return <div>
      <h1>C3</h1>
      <p>count: {count}</p>
      <button onClick={() => this.props.store.increment()}>Increment</button>
    </div>
  }
}

export default withStore(C3);