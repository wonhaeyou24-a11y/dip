import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, PHOTO_CATEGORIES, uid, type Photo, type PhotoCategory } from '../db/db';
import { getCurrentGps } from '../lib/geo';
import { processPhoto, useObjectUrl } from '../lib/photo';

interface Props {
  facilityId: string;
  stationId: string;
}

export function PhotoGrid({ facilityId, stationId }: Props) {
  const photos = useLiveQuery(
    () => db.photos.where('stationId').equals(stationId).toArray(),
    [stationId],
    [] as Photo[],
  );
  const byCat = new Map<PhotoCategory, Photo>();
  for (const p of photos) byCat.set(p.category, p);

  return (
    <div className="photo-grid">
      {PHOTO_CATEGORIES.map((cat) => (
        <PhotoSlot
          key={cat}
          category={cat}
          photo={byCat.get(cat)}
          facilityId={facilityId}
          stationId={stationId}
        />
      ))}
    </div>
  );
}

function PhotoSlot({
  category,
  photo,
  facilityId,
  stationId,
}: {
  category: PhotoCategory;
  photo?: Photo;
  facilityId: string;
  stationId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = useObjectUrl(photo?.thumbnail ?? photo?.blob);

  const onFile = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const { display, thumbnail } = await processPhoto(file);
      let gps;
      try {
        gps = await getCurrentGps(6000);
      } catch {
        gps = undefined;
      }
      await db.transaction('rw', db.photos, async () => {
        if (photo) await db.photos.delete(photo.id);
        await db.photos.add({
          id: uid(),
          facilityId,
          stationId,
          category,
          blob: display,
          thumbnail,
          gps,
          takenAt: Date.now(),
        });
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '사진 저장 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="photo-slot">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />
      <button
        className="photo-thumb"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={`${category} 촬영`}
      >
        {url ? <img src={url} alt={category} /> : <span>{busy ? '처리 중…' : '＋ 촬영'}</span>}
      </button>
      <div className="photo-cap">
        <span>{category}</span>
        {photo && (
          <button className="link-danger" onClick={() => db.photos.delete(photo.id)} aria-label="사진 삭제">
            삭제
          </button>
        )}
      </div>
      {err && <div className="warn">{err}</div>}
    </div>
  );
}
