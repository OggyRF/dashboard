import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Privacy" };

// Public page that Google's consent screen links to.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-relaxed lg:py-12">
      <Logo tone="dark" />
      <h1 className="page-title">Privacy policy</h1>
      <p>
        The HI Digital team dashboard is an internal tool of HI Digital Solution LLP, used only by its own staff. It is not offered to the public.
      </p>
      <h2 className="text-base font-bold">Google data</h2>
      <p>
        When an owner connects the agency Google account, the dashboard asks only for read-only access to Google Search Console. It reads search
        performance (clicks, impressions, click-through rate, position, searches, pages, devices and countries) for the websites of HI Digital&apos;s
        clients, and shows it to the HI Digital staff working on those clients. It never changes anything in Google.
      </p>
      <p>
        The Google sign-in is stored encrypted and is used for nothing else. The data is not sold, shared with anyone outside HI Digital, or used for
        advertising. Disconnecting Google in the dashboard&apos;s settings, or removing access at myaccount.google.com/permissions, stops all access.
      </p>
      <h2 className="text-base font-bold">Contact</h2>
      <p>HI Digital Solution LLP · hidigital.co.in</p>
    </main>
  );
}
