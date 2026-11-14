import { useEffect } from 'react';
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { FacilityScreen } from './screens/FacilityScreen';
import { ProjectScreen } from './screens/ProjectScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SetScreen } from './screens/SetScreen';
import { SoilScreen } from './screens/SoilScreen';
import { StationScreen } from './screens/StationScreen';
import { UpdatePrompt } from './components/UpdatePrompt';
import { db, ensurePersistentStorage, migrateLegacyPhotos } from './db/db';
import { NavTracker, useGoParent } from './lib/nav';
import { HeaderProvider, useHeader } from './lib/headerContext';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { subtitle } = useHeader();
  const { pid, fid, sid } = useParams();
  const fac = useLiveQuery(() => (fid ? db.facilities.get(fid) : undefined), [fid]);
  const atRoot = title === '프로젝트';
  // 화면마다 정해진 부모 화면 (‹ 는 기록이 아니라 이 규칙으로 간다)
  const parent =
    title === '시설물 목록' && pid ? '/' :
    title === '시설물 조사' ? (fac?.projectId ? `/p/${fac.projectId}` : '/') :
    title === '측점 조사' || title === '토양경도 조사' ? `/f/${fid}` :
    title === '절리군 조사' ? `/f/${fid}/s/${sid}` :
    '/';
  const goBack = useGoParent(parent);
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          {!atRoot ? (
            <button className="back" onClick={goBack} aria-label="뒤로">
              ‹
            </button>
          ) : (
            <span className="back" aria-hidden />
          )}
          <div className="app-header-titles">
            <h1>{title}</h1>
            {subtitle && <span className="app-subtitle">{subtitle}</span>}
          </div>
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
      <HeaderProvider>
        <ScrollToTop />
        <NavTracker />
        <UpdatePrompt />
        <Routes>
        <Route
          path="/"
          element={
            <Shell title="프로젝트">
              <ProjectsScreen />
            </Shell>
          }
        />
        <Route
          path="/p/:pid"
          element={
            <Shell title="시설물 목록">
              <ProjectScreen />
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
            <Shell title="프로젝트">
              <ProjectsScreen />
            </Shell>
          }
        />
        </Routes>
      </HeaderProvider>
    </HashRouter>
  );
}
