export default function ZoneHeader({ label }: { label: string }) {
  return (
    <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
      {label}
    </h2>
  )
}
