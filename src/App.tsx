import { MeasureScreen } from './screens/MeasureScreen';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>불연속면 조사</h1>
        <div className="sub">STEP 2 · 주향·경사 측정 엔진 (프로토타입)</div>
      </header>
      <main className="app-body">
        <MeasureScreen />
      </main>
    </div>
  );
}
