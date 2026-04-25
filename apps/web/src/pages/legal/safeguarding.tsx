import { useDocumentMeta } from "@/hooks/use-document-meta.js";

export function Component() {
  useDocumentMeta(
    "Safeguarding",
    "Percy Main Community Sports Club's safeguarding approach for junior cricket sessions: DBS-checked coaches, Level 3 Club Safeguarding Officer, and ECB-aligned policies.",
  );

  return (
    <div className="container p-4 pt-8">
      <h1>Safeguarding</h1>

      <div className="prose max-w-none [&_h2]:mt-8 [&_h2]:mb-4 [&_p]:my-4 [&_ul]:list-disc [&_ul]:pl-8">
        <p>
          Percy Main Community Sports Club takes the safety and welfare of
          children and young people in our care very seriously. This page
          summarises how we work; the full club Safeguarding Policy document is
          held by the trustees and is available on request to parents,
          guardians, coaches, volunteers, and ECB officers.
        </p>

        <h2>Who is in charge</h2>
        <p>
          Our Club Safeguarding Officer holds the ECB Level 3 Safeguarding
          qualification and is the primary contact for any concern, question, or
          report relating to junior players. They can be reached via{" "}
          <a
            className="text-blue-900 underline"
            href="mailto:trustees@percymain.org"
          >
            trustees@percymain.org
          </a>
          .
        </p>

        <h2>Coaches and volunteers</h2>
        <ul>
          <li>
            Every adult who works regularly with junior players holds a current
            Enhanced DBS check, refreshed at least every three years.
          </li>
          <li>
            Junior sessions are always run with at least two adults present; no
            coach, volunteer, or parent ever has unsupervised one-to-one access
            to a child during club activity.
          </li>
          <li>
            Coaches working with junior cricket squads hold appropriate ECB
            coaching qualifications and complete the ECB Safe Hands safeguarding
            workshop.
          </li>
        </ul>

        <h2>What you can expect from a junior session</h2>
        <ul>
          <li>Sessions start and finish at advertised times.</li>
          <li>
            Parents and guardians are welcome to stay and watch any junior
            session.
          </li>
          <li>
            We collect emergency contact and medical information when a child
            joins, kept secure and used only when needed during sessions.
          </li>
          <li>
            We do not photograph or film junior sessions for public-facing
            content without specific written parental consent on a per-event
            basis.
          </li>
        </ul>

        <h2>Reporting a concern</h2>
        <p>
          If you have a concern about the welfare of a child in our care, or
          about the conduct of any adult connected to the club, please email{" "}
          <a
            className="text-blue-900 underline"
            href="mailto:trustees@percymain.org"
          >
            trustees@percymain.org
          </a>{" "}
          marked &ldquo;Safeguarding&rdquo;. Concerns are taken seriously,
          handled discreetly, and escalated as appropriate to the ECB
          Safeguarding Team or to local authority Children&rsquo;s Services.
        </p>
        <p>
          You can also contact the NSPCC helpline on 0808 800 5000 or, in an
          emergency, dial 999.
        </p>

        <h2>Wider framework</h2>
        <p>
          Our policies follow the framework set out by the England and Wales
          Cricket Board (ECB) for affiliated clubs. The ECB&rsquo;s public
          safeguarding policies and resources are available at{" "}
          <a
            className="text-blue-900 underline"
            href="https://www.ecb.co.uk/news/3340261/policies-safeguarding"
            target="_blank"
            rel="noopener noreferrer"
          >
            ecb.co.uk/news/3340261/policies-safeguarding
          </a>
          .
        </p>

        <h2>Last updated</h2>
        <p>25 April 2026.</p>
      </div>
    </div>
  );
}
