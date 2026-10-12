import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { keyFromDbDate } from "@/lib/dates";
import { getClient, listTeam } from "@/services/clients";
import { DeleteButton } from "@/components/delete-button";
import { deleteClientAction } from "@/server/actions/clients";
import { ClientForm } from "../../client-form";
import { TeamForm } from "./team-form";

export default async function ClientSettings({ params }: PageProps<"/clients/[clientId]/settings">) {
  const user = await requireUser();
  const { clientId } = await params;
  const { client, access } = await getClient(user, clientId);
  if (access !== "full" || !can(user.role, "clients.edit")) redirect(`/clients/${clientId}`);
  const people = await listTeam();
  const locked = [
    client.strategicOwnerId && `${client.strategicOwnerId}:STRATEGY`,
    client.executionOwnerId && `${client.executionOwnerId}:EXECUTION`,
    client.offpageOwnerId && `${client.offpageOwnerId}:OFFPAGE`,
  ].filter((v): v is string => !!v);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card">
        <h2 className="mb-4 text-lg font-bold">Client details</h2>
        <ClientForm
          people={people}
          values={{
            id: client.id,
            name: client.name,
            website: client.website ?? "",
            type: client.type,
            status: client.status,
            industry: client.industry ?? "",
            location: client.location ?? "",
            startDate: client.startDate ? keyFromDbDate(client.startDate) : "",
            goals: client.goals ?? "",
            notes: client.notes ?? "",
            strategicOwnerId: client.strategicOwnerId ?? "",
            executionOwnerId: client.executionOwnerId ?? "",
            offpageOwnerId: client.offpageOwnerId ?? "",
          }}
        />
        <p className="mt-4 text-xs text-muted">To stop work with a client, set the status to Churned. Its history stays and its chat channel is archived.</p>
      </section>
      <section className="card">
        <h2 className="text-lg font-bold">Who works on this client</h2>
        <p className="mb-4 text-sm text-muted">The team sees this client and its #{client.channel?.name} chat. Off-page staff see only the Off-page and Chat tabs.</p>
        <TeamForm
          clientId={client.id}
          people={people}
          current={client.assignments.map((a) => `${a.userId}:${a.responsibility}`)}
          locked={locked}
        />
      </section>
      {can(user.role, "data.delete") && (
        <section className="card border-danger/30 lg:col-span-2">
          <h2 className="text-lg font-bold text-danger">Delete this client</h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            Removes {client.name} for good, with its tasks, off-page plan and checklist, daily task lines, #{client.channel?.name} chat and Search Console data. To only stop working with a client and keep its history, set the status to Churned instead.
          </p>
          <DeleteButton
            action={deleteClientAction}
            fields={{ clientId: client.id }}
            label="Delete client"
            confirmText={`Delete ${client.name} and everything under it? This cannot be undone.`}
            typeName={client.name}
          />
        </section>
      )}
    </div>
  );
}
