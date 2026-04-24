import { useDocumentMeta } from "@/hooks/use-document-meta.js";

export function Component() {
  useDocumentMeta(
    "Privacy Policy",
    "Percy Main Community Sports Club privacy policy and data protection information.",
  );

  return (
    <div className="container p-4 pt-8">
      <h1>Privacy Policy</h1>

      <div className="prose max-w-none [&_h2]:mt-8 [&_h2]:mb-4 [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-4 [&_ul]:list-disc [&_ul]:pl-8">
        <div>
          <h2>Customer privacy notice</h2>
          <p>
            This privacy notice tells you what to expect us to do with your
            personal information.
          </p>
        </div>

        {/* Table of contents */}
        <ul>
          <li>
            <a className="text-blue-900 underline" href="#contact">
              Contact details
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#collect">
              What information we collect, use, and why
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#lawful">
              Lawful bases and data protection rights
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#infofrom">
              Where we get personal information from
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#retention">
              How long we keep information
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#share">
              Who we share information with
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#incidents">
              Accident and incident reports
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#complain">
              How to complain
            </a>
          </li>
        </ul>

        {/* Contact details */}
        <h2 id="contact" className="scroll-mt-40">
          Contact details
        </h2>
        <h3>Email</h3>
        <p>
          <a
            className="text-blue-900 underline"
            href="mailto:trustees@percymain.org"
          >
            trustees@percymain.org
          </a>
        </p>

        {/* What information we collect */}
        <h2 id="collect" className="scroll-mt-40">
          What information we collect, use, and why
        </h2>
        <p>
          We collect or use the following information to{" "}
          <strong>
            receive donations or funding and organise fundraising activities
          </strong>
          :
        </p>
        <ul>
          <li>Names and contact details</li>
          <li>Addresses</li>
          <li>Payment or banking details</li>
          <li>Donation history</li>
          <li>Health information</li>
        </ul>

        <p>
          We collect or use the following personal information for{" "}
          <strong>service updates or marketing purposes</strong>:
        </p>
        <ul>
          <li>Names and contact details</li>
          <li>Marketing preferences</li>
          <li>IP addresses</li>
          <li>Website and app user journey information</li>
        </ul>

        <p>
          We collect or use the following personal information to{" "}
          <strong>comply with legal requirements</strong>:
        </p>
        <ul>
          <li>Name</li>
          <li>Contact information</li>
          <li>Health and safety information</li>
        </ul>

        <p>
          We collect or use the following personal information to{" "}
          <strong>
            record, review and respond to accidents, incidents and safety
            concerns
          </strong>
          :
        </p>
        <ul>
          <li>Names and contact details of the reporter</li>
          <li>
            Name and age indication (adult or under 18) of the person affected
          </li>
          <li>
            Details of the incident — date, time, location, activity, and a
            description of what happened
          </li>
          <li>
            Health-related information where relevant — for example whether an
            injury occurred and what first aid or emergency care was given
          </li>
          <li>Witness details where known</li>
        </ul>

        <p>
          We collect or use the following personal information for{" "}
          <strong>dealing with queries, complaints or claims</strong>:
        </p>
        <ul>
          <li>Names and contact details</li>
        </ul>

        {/* Lawful bases */}
        <h2 id="lawful" className="scroll-mt-40">
          Lawful bases and data protection rights
        </h2>
        <p>
          Under UK data protection law, we must have a &ldquo;lawful
          basis&rdquo; for collecting and using your personal information. There
          is a list of possible lawful bases in the UK GDPR. You can find out
          more about lawful bases on the ICO&rsquo;s website.
        </p>
        <p>
          Which lawful basis we rely on may affect your data protection rights
          which are in brief set out below. You can find out more about your
          data protection rights and the exemptions which may apply on the
          ICO&rsquo;s website:
        </p>
        <ul>
          <li>
            <strong>Your right of access</strong> &mdash; You have the right to
            ask us for copies of your personal information. You can request
            other information such as details about where we get personal
            information from and who we share personal information with. There
            are some exemptions which means you may not receive all the
            information you ask for.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#roa"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to rectification</strong> &mdash; You have the
            right to ask us to correct or delete personal information you think
            is inaccurate or incomplete.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rtr"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to erasure</strong> &mdash; You have the right to
            ask us to delete your personal information.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rte"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to restriction of processing</strong> &mdash; You
            have the right to ask us to limit how we can use your personal
            information.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rtrop"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to object to processing</strong> &mdash; You have
            the right to object to the processing of your personal data.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rto"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to data portability</strong> &mdash; You have the
            right to ask that we transfer the personal information you gave us
            to another organisation, or to you.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rtdp"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
          <li>
            <strong>Your right to withdraw consent</strong> &mdash; When we use
            consent as our lawful basis you have the right to withdraw your
            consent at any time.{" "}
            <a
              className="text-blue-900 underline"
              href="https://ico.org.uk/for-organisations/advice-for-small-organisations/create-your-own-privacy-notice/your-data-protection-rights/#rtwc"
              target="_blank"
              rel="noopener noreferrer"
            >
              You can read more about this right here
            </a>
            .
          </li>
        </ul>
        <p>
          If you make a request, we must respond to you without undue delay and
          in any event within one month.
        </p>
        <p>
          To make a data protection rights request, please contact us using the
          contact details at the top of this privacy notice.
        </p>

        <h3>Our lawful bases for the collection and use of your data</h3>

        <p>
          Our lawful bases for collecting or using personal information to{" "}
          <strong>
            receive donations or funding and organise fundraising activities
          </strong>{" "}
          are:
        </p>
        <ul>
          <li>
            <strong>Consent</strong> &mdash; we have permission from you after
            we gave you all the relevant information. All of your data
            protection rights may apply, except the right to object. To be
            clear, you do have the right to withdraw your consent at any time.
          </li>
          <li>
            <strong>Legal obligation</strong> &mdash; we have to collect or use
            your information so we can comply with the law. All of your data
            protection rights may apply, except the right to erasure, the right
            to object and the right to data portability.
          </li>
        </ul>

        <p>
          Our lawful bases for collecting or using personal information for{" "}
          <strong>service updates or marketing purposes</strong> are:
        </p>
        <ul>
          <li>
            <strong>Consent</strong> &mdash; we have permission from you after
            we gave you all the relevant information. All of your data
            protection rights may apply, except the right to object. To be
            clear, you do have the right to withdraw your consent at any time.
          </li>
        </ul>

        <p>
          Our lawful bases for collecting or using personal information to{" "}
          <strong>comply with legal requirements</strong> are:
        </p>
        <ul>
          <li>
            <strong>Consent</strong> &mdash; we have permission from you after
            we gave you all the relevant information. All of your data
            protection rights may apply, except the right to object. To be
            clear, you do have the right to withdraw your consent at any time.
          </li>
          <li>
            <strong>Legal obligation</strong> &mdash; we have to collect or use
            your information so we can comply with the law. All of your data
            protection rights may apply, except the right to erasure, the right
            to object and the right to data portability.
          </li>
          <li>
            <strong>Legitimate interests</strong> &mdash; we&rsquo;re collecting
            or using your information because it benefits you, our organisation
            or someone else, without causing an undue risk of harm to anyone.
            All of your data protection rights may apply, except the right to
            portability. Our legitimate interests are:
          </li>
        </ul>
        <p>
          Health information is collected to ensure the safety of people using
          our facilities, and ensure any necessary adjustments to can be made to
          accomodate their needs.
        </p>

        <p>
          Our lawful bases for collecting or using personal information for{" "}
          <strong>dealing with queries, complaints or claims</strong> are:
        </p>
        <ul>
          <li>
            <strong>Consent</strong> &mdash; we have permission from you after
            we gave you all the relevant information. All of your data
            protection rights may apply, except the right to object. To be
            clear, you do have the right to withdraw your consent at any time.
          </li>
        </ul>

        {/* Where we get personal information from */}
        <h2 id="infofrom" className="scroll-mt-40">
          Where we get personal information from
        </h2>
        <ul>
          <li>Directly from you</li>
        </ul>

        {/* How long we keep information */}
        <h2 id="retention" className="scroll-mt-40">
          How long we keep information
        </h2>
        <p>
          Personal information is kept for the duration of a person&rsquo;s
          membership, and for 36 months thereafter.
        </p>

        {/* Who we share information with */}
        <h2 id="share" className="scroll-mt-40">
          Who we share information with
        </h2>
        <h3>Data processors</h3>

        <p>
          <strong>Stripe</strong>
        </p>
        <p>
          This data processor does the following activities for us: Payment
          processor
        </p>

        <p>
          <strong>Google</strong>
        </p>
        <p>
          This data processor does the following activities for us: Data storage
        </p>

        <p>
          <strong>Retool</strong>
        </p>
        <p>
          This data processor does the following activities for us: Data
          processing and storage
        </p>

        {/* Accident and incident reports */}
        <h2 id="incidents" className="scroll-mt-40">
          Accident and incident reports
        </h2>
        <p>
          The club provides a form for reporting accidents, injuries, near
          misses and safety concerns at{" "}
          <a className="text-blue-900 underline" href="/report-incident">
            /report-incident
          </a>
          . Information submitted through this form is used to record, review
          and respond to the incident, and to demonstrate responsible health and
          safety governance.
        </p>
        <p>
          Reports may include health-related information (for example details of
          an injury or first aid given). We treat this information as sensitive
          and only use it for the purposes set out below.
        </p>
        <p>
          <strong>Who can see accident and incident reports:</strong> access is
          restricted to authorised club admins. These individuals are DBS
          checked and safeguarding aware. Reports involving people under 18 are
          handled with particular care and, where appropriate, discussed with
          the club&rsquo;s safeguarding officer.
        </p>
        <p>
          <strong>How long we keep them:</strong> accident, incident and health
          and safety records are retained for as long as is necessary to meet
          our health and safety, insurance and legal obligations. Where children
          are involved, records may be kept for longer in line with safeguarding
          guidance.
        </p>
        <p>
          <strong>Who we may share them with:</strong> where necessary and
          lawful, we may share information from accident and incident reports
          with third parties including our insurers, relevant sport governing
          bodies (for example the England and Wales Cricket Board or the
          Northumberland &amp; Tyneside Cricket League), emergency services,
          local authorities, safeguarding agencies and regulators such as the
          Health and Safety Executive.
        </p>

        {/* How to complain */}
        <h2 id="complain" className="scroll-mt-40">
          How to complain
        </h2>
        <p>
          If you have any concerns about our use of your personal data, you can
          make a complaint to us using the contact details at the top of this
          privacy notice.
        </p>
        <p>
          If you remain unhappy with how we&rsquo;ve used your data after
          raising a complaint with us, you can also complain to the ICO.
        </p>
        <p>The ICO&rsquo;s address:</p>
        <p>
          Information Commissioner&rsquo;s Office
          <br />
          Wycliffe House
          <br />
          Water Lane
          <br />
          Wilmslow
          <br />
          Cheshire
          <br />
          SK9 5AF
        </p>
        <p>Helpline number: 0303 123 1113</p>
        <p>
          Website:{" "}
          <a
            className="text-blue-900 underline"
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://www.ico.org.uk/make-a-complaint
          </a>
        </p>

        <h2>Last updated</h2>
        <p>24 April 2026</p>
      </div>
    </div>
  );
}
