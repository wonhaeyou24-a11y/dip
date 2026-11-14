// 데스크(피치샷 데스크)가 쓰는 계산·그리기 코드를 한 파일로 묶는 입구 — scripts/build-desk-lib.mjs 가 CommonJS 로 묶어 데스크 sync/dipLib.js 로 내보낸다.
export { clusterPoles, recomputeSets, suggestK, planeAngle, meanPlane, poleVec } from '../src/lib/setCluster';
export { kinematic, kinematic3, intersection, angDiff, LEVEL_TEXT } from '../src/lib/kinematic';
export { stereoSvg, fisherDensity, greatCirclePoints } from '../src/lib/stereo';
