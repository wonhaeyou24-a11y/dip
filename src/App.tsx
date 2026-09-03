import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { FacilitiesScreen } from './screens/FacilitiesScreen';
import { FacilityScreen } from './screens/FacilityScreen';
import { SetScreen } from './screens/SetScreen';
import { StationScreen } from './screens/StationScreen';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const atRoot = title === '시설물';
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          {!atRoot ? (
            <button className="back" onClick={() => navigate(-1)} aria-label="뒤로">
              ‹
            </button>
          ) : (
            <span className="back" aria-hidden />
          )}
          <h1>{title}</h1>
          <Link to="/" className="home" aria-label="처음으로">
            ⌂
          </Link>
        </div>
      </header>
      <main className="app-body">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Shell title="시설물">
              <FacilitiesScreen />
            </Shell>
          }
        />
        <Route
          path="/f/:fid"
          element={
            <Shell title="측점 목록">
              <FacilityScreen />
            </Shell>
          }
        />
        <Route
          path="/f/:fid/s/:sid"
          element={
            <Shell title="측점 조사">
              <StationScreen />
            </Shell>
          }
        />
        <Route
          path="/f/:fid/s/:sid/set/:setid"
          element={
            <Shell title="절리군 조사">
              <SetScreen />
            </Shell>
          }
        />
        <Route
          path="*"
          element={
            <Shell title="시설물">
              <FacilitiesScreen />
            </Shell>
          }
        />
      </Routes>
    </HashRouter>
  );
}
