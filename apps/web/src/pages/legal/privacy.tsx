import { useDocumentMeta } from "@/hooks/use-document-meta.js";
import {
  CURRENT_CONSENT_VERSION,
  requestConsentReopen,
} from "@/lib/marketing/consent.js";

export function Component() {
  useDocumentMeta(
    "Privacy Policy",
    "Percy Main Community Sports Club privacy policy and data protection information.",
  );

  const openCookieSettings = () => requestConsentReopen();

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
            <a className="text-blue-900 underline" href="#service-vs-marketing">
              Service communications vs direct marketing
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#lawful">
              Lawful bases and data protection rights
            </a>
          </li>
          <li>
            <a className="text-blue-900 underline" href="#cookies">
              Cookies and Google tagging
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
          We collect or use the following information when someone submits a{" "}
          <strong>trial, enquiry, or lead form</strong> on our site:
        </p>
        <ul>
          <li>Name (or child&rsquo;s name plus parent/guardian name)</li>
          <li>Email address and, optionally, phone number</li>
          <li>Free-text notes the submitter chooses to add</li>
          <li>
            The campaign and segment the form belonged to (e.g. men&rsquo;s
            cricket, junior girls Dynamos)
          </li>
          <li>
            Attribution data tied to the click that brought them to the site
            (Google <code>gclid</code>, UTM parameters, landing page and
            referrer) &mdash; only when the visitor has accepted cookies via our
            consent banner
          </li>
          <li>
            A snapshot of the consent choices that were in force at the moment
            the form was submitted
          </li>
        </ul>

        <p>
          We collect or use the following personal information for{" "}
          <strong>service updates and operational communications</strong>:
        </p>
        <ul>
          <li>Names and contact details</li>
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

        {/* Service vs marketing */}
        <h2 id="service-vs-marketing" className="scroll-mt-40">
          Service communications vs direct marketing
        </h2>
        <p>
          We treat these two categories differently, and we want you to know the
          difference.
        </p>
        <p>
          <strong>Service communications</strong> are the messages we send back
          in reply to something you asked us for. If you submit a trial form, we
          reply about your trial. If you email the club, we reply about your
          email. That isn&rsquo;t marketing &mdash; it&rsquo;s the club
          honouring your original request, and we rely on that request as our
          lawful basis to get back to you.
        </p>
        <p>
          <strong>Direct marketing</strong> means newsletters, fundraising asks,
          seasonal recruitment reminders, sponsor promotions, and anything else
          we send without a specific prior request from you. We do not currently
          operate a marketing list. If we ever do, it will be separate from any
          enquiry you&rsquo;ve made, it will be opt-in, and every message will
          include a one-click unsubscribe.
        </p>

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
          Our lawful basis for{" "}
          <strong>responding to a trial or enquiry form</strong> is{" "}
          <strong>legitimate interest</strong> and pre-contract necessity
          &mdash; you actively submitted a form asking us to get in touch, and
          replying is in scope of that request.
        </p>
        <p>
          Our lawful basis for <strong>storing the attribution cookie</strong> (
          <code>pm_attrib</code>), <strong>loading Google Analytics</strong>,
          and <strong>sending conversion measurement to Google Ads</strong> is{" "}
          <strong>consent</strong>, captured via our cookie banner and recorded
          with a version number and timestamp. Sending your hashed email address
          to Google for Enhanced Conversions is a separate consent axis
          (&ldquo;ad_user_data&rdquo;) &mdash; we only do that when you have
          granted it.
        </p>

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
          Our lawful bases for collecting or using personal information to{" "}
          <strong>comply with legal requirements</strong> are:
        </p>
        <ul>
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
            portability.
          </li>
        </ul>
        <p>
          Health information is collected to ensure the safety of people using
          our facilities, and ensure any necessary adjustments can be made to
          accommodate their needs.
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

        {/* Cookies + Consent Mode */}
        <h2 id="cookies" className="scroll-mt-40">
          Cookies and Google tagging
        </h2>
        <p>
          We use a small number of cookies. Two are ours, the rest are set by
          Google when we load their tag.
        </p>
        <h3>Our cookies</h3>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2 text-left">Purpose</th>
              <th className="px-2 py-2 text-left">Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="px-2 py-2 align-top">
                <code>pm_consent</code>
              </td>
              <td className="px-2 py-2 align-top">
                Records your cookie choice on the banner, with the version of
                this notice you accepted against. First-party.
              </td>
              <td className="px-2 py-2 align-top">12 months</td>
            </tr>
            <tr className="border-b">
              <td className="px-2 py-2 align-top">
                <code>pm_attrib</code>
              </td>
              <td className="px-2 py-2 align-top">
                Stores which ad click brought you to the site (Google{" "}
                <code>gclid</code>, UTM parameters, landing page, referrer) so
                we can credit our recruitment campaigns. Only written after you
                have granted cookie consent. First-party.
              </td>
              <td className="px-2 py-2 align-top">90 days</td>
            </tr>
          </tbody>
        </table>
        <h3>Google cookies</h3>
        <p>
          If you accept, Google&rsquo;s tag sets its own cookies (
          <code>_ga</code>, <code>_gid</code>, <code>_gcl_au</code>, and others
          depending on the Google product) to measure traffic and ad
          performance.
        </p>
        <h3>How our consent banner works (Consent Mode v2)</h3>
        <p>
          Google&rsquo;s tag (<code>gtag.js</code>) is loaded on every page of
          this site, regardless of whether you have accepted or declined
          cookies. What changes is what the tag is allowed to do:
        </p>
        <ul>
          <li>
            <strong>Before you decide, or if you decline:</strong> the tag runs
            in &ldquo;denied&rdquo; mode. It sends Google traffic signals
            without identifiers attached, so Google can measure aggregate ad
            performance without reading or writing cookies that identify you.
          </li>
          <li>
            <strong>If you accept:</strong> the tag reads and writes its full
            set of cookies and sends us and Google the full measurement signals.
            On form submissions, we also send Google a SHA-256 hash of the email
            address you entered so that Google can match your conversion back to
            the ad you clicked (Enhanced Conversions). Hashed email is still
            personal data under UK GDPR &mdash; we only send it when you have
            granted the &ldquo;ad_user_data&rdquo; axis via the banner.
          </li>
        </ul>
        <h3>Changing your mind</h3>
        <p>
          You can change your choice at any time. Click{" "}
          <button
            type="button"
            onClick={openCookieSettings}
            className="inline text-blue-900 underline"
          >
            Cookie settings
          </button>{" "}
          here, or use the &ldquo;Cookie settings&rdquo; link in the site
          footer. The banner will re-open and your new choice takes effect
          immediately &mdash; no page reload required.
        </p>
        <p className="text-sm text-gray-600">
          This notice version: {CURRENT_CONSENT_VERSION}. If we change what we
          send to Google in a way that materially affects this notice, we bump
          the version and the banner re-appears so you can re-decide.
        </p>

        {/* Where we get personal information from */}
        <h2 id="infofrom" className="scroll-mt-40">
          Where we get personal information from
        </h2>
        <ul>
          <li>Directly from you</li>
          <li>
            Through Google Ads click identifiers when you arrive via one of our
            adverts &mdash; only after you have accepted cookies
          </li>
        </ul>

        {/* How long we keep information */}
        <h2 id="retention" className="scroll-mt-40">
          How long we keep information
        </h2>
        <p>
          Personal information relating to a member is kept for the duration of
          a person&rsquo;s membership, and for 36 months thereafter.
        </p>
        <p>
          Lead records (name, email, phone, notes and the associated events) for
          people who submit a trial or enquiry form but do not go on to become
          members are kept for 3 years from the date of submission, then
          automatically deleted.
        </p>

        {/* Who we share information with */}
        <h2 id="share" className="scroll-mt-40">
          Who we share information with
        </h2>
        <h3>Data processors</h3>

        <p>
          <strong>Amazon Web Services (AWS)</strong>
        </p>
        <p>
          Hosts our website, API, database, file uploads, and transactional
          email delivery (via Amazon SES).
        </p>

        <p>
          <strong>Stripe</strong>
        </p>
        <p>Payment processing for memberships, match fees, and sponsorships.</p>

        <p>
          <strong>Google (Workspace, Analytics, Ads)</strong>
        </p>
        <p>
          Google Workspace hosts the club&rsquo;s email and shared documents.
          Google Analytics 4 gives us aggregate site traffic reporting. Google
          Ads is how we run our recruitment advertising; Google receives
          measurement signals from our pages and, for people who have accepted
          the banner, hashed email addresses submitted via our lead forms so it
          can match conversions back to ad clicks. We also periodically upload
          anonymised conversion records (e.g. &ldquo;this lead attended a
          trial&rdquo;, &ldquo;this lead became a member&rdquo;) so Google Ads
          can optimise future campaigns.
        </p>

        <p>
          <strong>Better-Auth</strong>
        </p>
        <p>
          Provides the authentication layer for members signing in to the
          website.
        </p>

        <p>
          <strong>New Relic</strong>
        </p>
        <p>
          Application performance monitoring &mdash; helps us spot and fix
          errors on the site.
        </p>

        <p>
          <strong>Slack</strong>
        </p>
        <p>
          Receives operational notifications when someone submits a contact,
          enquiry, trial, or payment. Slack is used by a small number of club
          volunteers; lead information is not posted publicly.
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
        <p>
          25 April 2026. Notice version {CURRENT_CONSENT_VERSION}. Signed off by
          the tech lead (Alex Young).
        </p>
      </div>
    </div>
  );
}
