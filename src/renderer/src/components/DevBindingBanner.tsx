import { trpc } from '@renderer/lib/trpc'

// Shows which roadmap item the worker is currently developing and offers a
// "stop" that unbinds the worker (leaving the item's status untouched). Renders
// nothing when there is no active binding.
export function DevBindingBanner() {
  const utils = trpc.useUtils()
  const binding = trpc.roadmap.getDevBinding.useQuery()
  const list = trpc.roadmap.list.useQuery()
  const clear = trpc.roadmap.clearDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })

  const b = binding.data
  if (!b) return null
  const item = list.data?.find((i) => i.id === b.itemId)

  return (
    <div className="dev-binding-banner">
      <span className="dev-binding-label">
        ▸ Developing: {item?.title ?? b.itemId} · {b.phase}
      </span>
      <button type="button" className="btn" onClick={() => clear.mutate()}>
        stop development
      </button>
    </div>
  )
}
