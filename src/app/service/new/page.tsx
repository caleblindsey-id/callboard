import { redirect } from 'next/navigation'
import { getCurrentUser, canCreateServiceTickets } from '@/lib/auth'
import { CreateServiceTicketForm } from './CreateServiceTicketForm'

export default async function NewServiceTicketPage() {
  const user = await getCurrentUser()
  if (!user?.role) redirect('/login')
  if (!canCreateServiceTickets(user)) redirect('/')
  return <CreateServiceTicketForm currentUser={{ id: user.id, role: user.role }} />
}
