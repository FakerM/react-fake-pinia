import React from "react";
import useCounterStore from "./store";
import useCounter2Store from "./twoStore";
const C1 = () => {
    const store = useCounterStore();
    const store2 = useCounter2Store();
    return <div>
        <div>c1: {store.count}</div>
        <div>store2: {store2.count}</div>
    </div>
}

export default C1;