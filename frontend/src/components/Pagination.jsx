// Page numbers to render: always the first and last page, a window around
// the current page, and null where a gap becomes an ellipsis.
function pageItems(page, pages, around = 1) {
  const items = []
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= around) items.push(p)
    else if (items[items.length - 1] !== null) items.push(null)
  }
  return items
}

const BTN = 'min-w-8 h-8 px-2.5 rounded-md border text-sm'

export default function Pagination({ page, pages, total, pageSize, onChange }) {
  if (total === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 mt-2" aria-label="Pagination">
      <div className="text-sm text-dark2">
        Showing <b className="text-dark">{first}–{last}</b> of <b className="text-dark">{total}</b>
      </div>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={`${BTN} bg-white border-border text-dark2 disabled:opacity-40`}
            disabled={page === 1} onClick={() => onChange(page - 1)}>
            ‹ Prev
          </button>
          {pageItems(page, pages).map((p, i) => (p === null ? (
            <span key={`gap${i}`} className="px-1 text-dark2">…</span>
          ) : (
            <button
              key={p} type="button" aria-current={p === page ? 'page' : undefined} onClick={() => onChange(p)}
              className={`${BTN} ${p === page
                ? 'bg-accentDeep text-white border-accentDeep'
                : 'bg-white text-dark2 border-border'}`}
            >
              {p}
            </button>
          )))}
          <button type="button" className={`${BTN} bg-white border-border text-dark2 disabled:opacity-40`}
            disabled={page === pages} onClick={() => onChange(page + 1)}>
            Next ›
          </button>
        </div>
      )}
    </nav>
  )
}
