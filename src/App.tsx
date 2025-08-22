import { useEffect, useCallback } from 'react'
import C1 from "./C1"
import C2 from "./C2"
import './App.css'
import useCounterStore from "./store"
import C3 from "./C3"
import test from "./test"
import useCounter2Store from "./twoStore"


function App() {
    const store = useCounterStore();
    const store2 = useCounter2Store();
    test();

    const getAsyncM = async () => {
        const ret = await store.asyncMethod();
        store.setCount(ret as number);
    }

    store2.$subscribe(useCallback((listener) => {
        console.log('store2 状态变更', listener);
    }, []))

    useEffect(() => {
        // store.count = 100;
        console.log("lalalal")

    }, [store2])
    const doubleGetter = () => {
        console.log(store.double);
        store.setCount(store.double);
        store2.setCount(store2.double);
    }
    return (
        <>
            <button onClick={() => store.increment()} > +</button >
            <C1 />
            <C2 />
            <C3 />
            {
                store.array.map((item, index) => {
                    return <div key={index}>{item}</div>
                })
            }
            {
                Object.keys(store.obj).map((item, index) => {
                    return <div key={index}>{item}:{store.obj[item]}</div>
                })
            }
            <button onClick={getAsyncM}>异步</button>
            <button onClick={() => doubleGetter()}>getter{store.double}</button>
            <button onClick={() => store.$reset()}>重置</button>
            <button onClick={() => store.change()}>change</button>
        </>
    )
}

export default App
