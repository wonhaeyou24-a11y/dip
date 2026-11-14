// 사용: node scripts/build-desk-lib.mjs "<데스크 sync 폴더>/dipLib.js"
import { build } from 'esbuild';
const out = process.argv[2];
if (!out) { console.error('출력 경로를 주세요'); process.exit(1); }
await build({
  entryPoints: ['scripts/desk-lib-entry.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: out, target: 'node18', legalComments: 'none',
  banner: { js: '// 자동 생성 파일 — dip 저장소의 src/lib (setCluster · kinematic · stereo) 를 묶은 것. 고치지 말고 dip 에서 고친 뒤 node scripts/build-desk-lib.mjs 로 다시 만들 것.' },
});
console.log('만들었습니다:', out);
