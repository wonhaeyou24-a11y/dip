import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db, uid, type OwnerType, type Photo } from '../db/db';
import { getCurrentGps } from '../lib/geo';
import { toResizedDataUrl } from '../lib/image';

interface Props {
  facilityId: string;
  ownerType: OwnerType;
  ownerId: string;
  categories: readonly string[];
}

export function PhotoGrid({ facilityId, ownerType, ownerId, categories }: Props) {
  const photos = useLiveQuery(
    () => db.photos.where('ownerId').equals(ownerId).toArray(),
    [ownerId],
    [] as Photo[],
  );
  const byCat = new Map<string, Photo>();
  for (const p of photos) if (p.dataUrl) byCat.set(p.category, p);

  return (
    <div className="photo-grid">
      {categories.map((cat) => (
        <PhotoSlot
          key={cat}
          category={cat}
          photo={byCat.get(cat)}
          facilityId={facilityId}
          ownerType={ownerType}
          ownerId={ownerId}
        />
      ))}
    </div>
  );
}

function PhotoSlot({
  category,
  photo,
  facilityId,
  ownerType,
  ownerId,
}: {
  category: string;
  photo?: Photo;
  facilityId: string;
  ownerType: OwnerType;
  ownerId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const { dataUrl, resized } = await toResizedDataUrl(file, 1400, 0.78);
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
          ownerType,
          ownerId,
          category,
          dataUrl,
          gps,
          takenAt: Date.now(),
        });
      });
      if (!resized) setErr('이미지 형식을 앱에서 표시하지 못할 수 있으나 원본은 저장되었습니다.');
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
        {photo?.dataUrl ? (
          <img src={photo.dataUrl} alt={category} />
        ) : (
          <span>{busy ? '처리 중…' : '＋ 촬영'}</span>
        )}
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
