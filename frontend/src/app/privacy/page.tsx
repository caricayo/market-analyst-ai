import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — arfour",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-t-black text-t-text font-mono px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/"
          className="text-t-green text-xs hover:underline mb-8 inline-block"
        >
          &larr; Back to arfour
        </Link>

        <h1 className="text-xl font-bold text-t-green mb-6 tracking-wider">
          PRIVACY POLICY
        </h1>
        <p className="text-xs text-t-dim mb-8">Last updated: February 2026</p>

        <div className="space-y-6 text-xs leading-relaxed">
          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              1. Information We Collect
            </h2>
            <p>When you use arfour, we collect:</p>
            <ul className="list-none ml-2 mt-1 space-y-1">
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Account information:</strong> email
                address (via email/password signup or Google OAuth)
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Analysis history:</strong> ticker
                symbols analyzed, timestamps, and AI-generated report content
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Credit transactions:</strong> credit
                usage, purchases, and refunds
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Payment data:</strong> processed
                securely by Stripe. We do not store credit card numbers.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              2. How We Use Your Data
            </h2>
            <p>We use your information to:</p>
            <ul className="list-none ml-2 mt-1 space-y-1">
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Authenticate your account and manage sessions
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Execute and deliver analysis reports
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Track and manage your credit balance
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Process payments via Stripe
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              3. Data Storage
            </h2>
            <p>
              Your data is stored in Supabase (PostgreSQL) hosted in the US
              (us-east-1). Authentication is managed by Supabase Auth. All data is
              transmitted over encrypted connections (TLS).
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              4. Third-Party Services
            </h2>
            <ul className="list-none ml-2 space-y-1">
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Supabase:</strong> database and
                authentication
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Stripe:</strong> payment processing
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">OpenAI:</strong> AI analysis
                generation (ticker symbols and analysis context are sent to the
                OpenAI API)
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                <strong className="text-t-green">Google:</strong> OAuth sign-in
                (optional)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              5. Data Sharing
            </h2>
            <p>
              We do not sell, rent, or share your personal information with third
              parties for marketing purposes. Data is only shared with the
              third-party services listed above as necessary to operate the Service.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              6. Data Retention
            </h2>
            <p>
              Your account data and analysis history are retained as long as your
              account is active. Analysis reports are stored indefinitely so you can
              access your history. When you delete your account, all associated data
              (profile, analyses, credit history) is permanently deleted.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              7. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="list-none ml-2 mt-1 space-y-1">
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Access your personal data (available via your account dashboard)
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Delete your account and all associated data
              </li>
              <li className="before:content-['›_'] before:text-t-green before:mr-1">
                Request a copy of your data
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              8. Cookies
            </h2>
            <p>
              arfour uses essential cookies only for authentication session
              management (Supabase Auth tokens). We do not use tracking cookies,
              analytics cookies, or advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              9. Changes to This Policy
            </h2>
            <p>
              We may update this privacy policy from time to time. Continued use of
              the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold text-t-amber mb-2 uppercase tracking-wider">
              10. Contact
            </h2>
            <p>
              For privacy-related questions or data requests, contact us at the
              email address provided in the application.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-t-border">
          <Link
            href="/terms"
            className="text-t-amber text-xs hover:underline"
          >
            Terms of Service &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
