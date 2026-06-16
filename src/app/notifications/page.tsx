import EnablePushButton from '@/components/push/EnablePushButton'

// Per-device push opt-in, reachable by every role from the sidebar footer. The
// admin Settings page (super_admin only) also carries this control, but techs
// can't open Settings — this is their durable, re-findable home for turning
// assignment notifications on or off, independent of the dismissible service-board
// banner. EnablePushButton handles every state itself (subscribe/unsubscribe/
// denied/iOS-install/unsupported), so the page is just a shell around it.
export default function NotificationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Notifications</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage push notifications on this device
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 max-w-xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            Push Notifications
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Turn on push notifications on this device to be alerted when a service ticket is
            assigned to you. You can turn them off again here at any time.
          </p>
          <EnablePushButton />
        </div>
      </div>
    </div>
  )
}
