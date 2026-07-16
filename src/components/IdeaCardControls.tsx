"use client";

// /ideas ポスターカードの「いいね」「ゴミ箱」操作ボタン（IdeasPoster.tsx専用の小さな
// クライアント島）。IdeaShapeCard.tsx（輪郭textPath・foreignObjectの精密なフォント
// フィッティング計算を持つ既存の重要コンポーネント）自体には手を入れず、その外側の
// 絶対配置ラッパー(IdeasPoster.tsx)にこのボタン群を兄弟要素として重ねることで、
// シェイプ内部のコンテンツレイアウト計算(safeArea/描画済み行数など)への影響をゼロにする。
//
// 配置: カード外接矩形の右上隅。シェイプの輪郭textPath(タイトル・日付)は輪郭沿いに流れる
// ため、矩形の隅は視覚的にシェイプ本体の余白（あるいは輪郭のごく近く）にあたり、
// テキストとの重なりが最も少ない位置になる。回転するカード(--rotate CSS変数)に対して
// 逆回転(rotate(calc(var(--rotate) * -1)))を適用し、ボタン自体は常に正立させる。
// CaseCard.tsx（お気に入り/ごみ箱ボタンの参考実装）と同じく、非アクティブ時は
// 親のgroup-hoverで初めて可視化する控えめな表示にする（アクティブ時は常時表示）。
export default function IdeaCardControls({
  liked,
  onToggleLike,
  trashed,
  trashMode,
  onToggleTrash,
}: {
  liked: boolean;
  onToggleLike: () => void;
  trashed: boolean;
  trashMode: boolean;
  onToggleTrash: () => void;
}) {
  return (
    <div
      className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 pointer-events-auto"
      style={{ transform: "rotate(calc(var(--rotate) * -1))" }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleTrash();
        }}
        aria-label={trashMode ? "復元" : "ゴミ箱に入れる"}
        className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-150 ${
          trashMode
            ? "bg-black/40 text-white opacity-100 hover:text-emerald-300"
            : trashed
              ? "bg-black/40 text-red-300 opacity-100"
              : "bg-black/25 text-white/80 opacity-0 group-hover:opacity-100 hover:text-red-300"
        }`}
      >
        {trashMode ? (
          // 復元アイコン（undo矢印。CaseCard.tsxと同一のパス）
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L4 10m0 0l5-5m-5 5h11a4 4 0 014 4v1" />
          </svg>
        ) : (
          // ごみ箱アイコン（CaseCard.tsxと同一のパス）
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.867 12.142A2 2 0 0115.138 21H8.862a2 2 0 01-1.995-1.858L6 7z"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleLike();
        }}
        aria-label={liked ? "いいねを解除" : "いいね"}
        className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-150 ${
          liked
            ? "bg-black/40 text-pink-400 opacity-100"
            : "bg-black/25 text-white/80 opacity-0 group-hover:opacity-100 hover:text-pink-300"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
          className="w-3 h-3"
        >
          {/* ハート（♥）アイコン。CaseCard.tsxの★(お気に入り)とは意味を分けるため、
              いいねには専用のハート形状を使う */}
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        </svg>
      </button>
    </div>
  );
}
