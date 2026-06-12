---
title: Create a service ticket
category: Technicians
roles: [super_admin, manager, coordinator, technician]
order: 15
summary: Open a new service (repair) ticket for a customer — available when your manager enables it for you.
last_verified: 2026-06-12
---

Most service tickets are opened by the office. But if your manager has turned on the permission for you, you can create one yourself — for example when you're on site and find a new problem to log. A ticket you create is **assigned to you automatically**.

## Before you start

This is a per-technician permission. If you don't see a **+ New Service Ticket** button on the Service Tickets screen, it isn't enabled for your account — ask your manager to turn it on.

## Create the ticket

1. Tap **Service Tickets**, then **+ New Service Ticket**.
2. **Customer** *(required)* — search by name or account number. If the customer is on **credit hold**, you'll see a warning: the ticket goes to the office for credit approval and work stays gated until it's released.
3. **Ship-To Location** — if the customer has ship-to addresses, pick one. It pre-fills the service address and filters the equipment list.
4. **Equipment** *(required)* — pick the machine. If it isn't on file, register it inline (at least a **Make or Model**). A serial that already exists for the customer is flagged.
5. **Ticket details:**
   - **Type** — *Inside (Shop)* or *Outside (Field)*. Outside adds a service-address section.
   - **Billing Type**, **Priority**, and **Labor Rate**.
   - **Problem Description** *(required)*.
   - **Diagnostic Fee** — optional, only if one was already invoiced in Synergy.
6. **Contact** *(required)* — a name, plus at least an email **or** phone. CallBoard pre-fills from the equipment, ship-to, or customer when it can.
7. **Assignment** — the ticket is **assigned to you**; techs can't assign a new ticket to someone else.
8. Tap **Create Service Ticket**. You land on the new ticket, ready to log your work — see [Complete a service ticket](/help/technicians/complete-a-service-ticket).

## Common questions

- **I don't see the New Service Ticket button.** The permission isn't enabled for your account — ask your manager to turn it on in Settings.
- **Can I assign it to another technician?** No — tickets you create are assigned to you. The office can reassign it afterward if needed.
- **The customer is on credit hold.** You can still create the ticket, but it routes to the office for credit approval and stays gated until released.
