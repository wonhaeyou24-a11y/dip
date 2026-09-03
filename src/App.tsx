import { useEffect } from 'react';
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { FacilitiesScreen } from './screens/FacilitiesScreen';
import { FacilityScreen } from './screens/FacilityScreen';
import { SetScreen } from './screens/SetScreen';
import { SoilScreen } from './screens/SoilScreen';
import { StationScreen } from './screens/StationScreen';
import { ensurePersistentStorage, migrateLegacyPhotos } from './db/db';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

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
  useEffect(() => {
    void ensurePersistentStorage();
    void migrateLegacyPhotos();
  }, []);

  return (
    <HashRouter>
      <ScrollToTop />
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
            <Shell title="시설물 조사">
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
          path="/f/:fid/soil/:soilId"
          element={
            <Shell title="토양경도 조사">
              <SoilScreen />
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
