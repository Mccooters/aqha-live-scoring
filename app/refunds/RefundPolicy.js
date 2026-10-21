"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

// The club's refund policy, published as approved on 21 October 2026. Keep
// the wording in step with the committee's document: every change here is a
// change to what people agree to at checkout. The one moving part is the
// refund email address (site_settings "refund_email", set by staff from the
// Memberships page); until it is set the policy says the address is coming.

const H = ({ children }) => (
  <h2 className="display" style={{ fontWeight: 700, fontSize: 20, margin: "26px 0 8px", color: "var(--leather)" }}>{children}</h2>
);
const P = ({ children }) => <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{children}</p>;
const B = ({ children }) => <strong style={{ color: "var(--leather)" }}>{children}</strong>;

export default function RefundPolicy() {
  const [email, setEmail] = useState(null); // null = not loaded / not set

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "refund_email")
      .maybeSingle()
      .then(({ data }) => {
        const v = data?.value?.email;
        if (!cancelled && typeof v === "string" && v.includes("@")) setEmail(v.trim());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <header className="header">
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--brass-soft)" }}>Hunter Coast Quarter Horse Association</div>
            <h1 className="display" style={{ fontWeight: 700, fontSize: 24, margin: "2px 0", color: "#F2EADB" }}>Refund policy</h1>
          </div>
          <Link href="/" style={{ color: "var(--brass-soft)", fontSize: 13, alignSelf: "center" }}>← Home</Link>
        </div>
      </header>
      <main className="wrap" style={{ fontSize: 15, color: "var(--ink)" }}>
        <P>
          This policy applies to every payment made through hcqha.com. It sets out when the Hunter Coast Quarter Horse
          Association (the club) gives refunds, how they are paid, and how to ask for one.
        </P>

        <H>Your rights under the Australian Consumer Law</H>
        <P>
          Nothing in this policy takes away the rights you have under the Australian Consumer Law. Those rights apply in NSW
          through the Fair Trading Act 1987 (NSW) and cannot be excluded by any club rule.
        </P>
        <P>
          When the club sells you a service, such as a place in a class, a clinic spot, a membership or a raffle ticket, the
          law guarantees that it will be provided with due care and skill, will be fit for the purpose you made known to the
          club, and will be supplied within a reasonable time. If the club fails one of these guarantees in a major way, you
          may cancel and be refunded for the part of the service you did not receive, or claim compensation for the drop in
          value. For a smaller failure the club will put it right within a reasonable time; if it cannot, you may cancel and
          be refunded.
        </P>
        <P>
          These guarantees do not give a right to a refund when you change your mind, enter the wrong class, or can no longer
          attend. The sections below say what the club offers in those situations. They are club decisions that sit on top
          of your legal rights, never in place of them.
        </P>

        <H>Show entries</H>
        <P>
          <B>Before entries close.</B> You may scratch any class, or your whole entry, up to the time entries close for that
          show. The class fees are refunded in full. If you scratch every class, the ground fee is refunded as well; the
          admin fee is not. The club keeps the admin fee on every scratch, because it pays for the secretary&apos;s work,
          which has already been done. The entry form says so before payment.
        </P>
        <P>
          <B>After entries close.</B> The draw has been made and the class is run on the basis of your entry, so class fees
          are not refunded if you scratch or do not show. There are three exceptions:
        </P>
        <ul style={{ margin: "0 0 10px", paddingLeft: 22, lineHeight: 1.5 }}>
          <li>
            If your horse is unfit or injured, or you are ill or injured, and you send the club a veterinary or medical
            certificate within 7 days of the show, the class fees are refunded in full. The ground fee is refunded if the
            horse did not attend; the admin fee is retained.
          </li>
          <li>
            If the club cancels or does not run a class you entered, its fee is refunded in full, or at your choice moved to
            another class at the same show with any difference refunded.
          </li>
          <li>
            If a judge is ineligible to judge your horse under AQHA rule 76.4, the entry fee for that class is refunded, as
            the AQHA rule book requires.
          </li>
        </ul>
        <P>
          <B>Wrong class.</B> Under AQHA rule 49.5 a horse entered in the wrong class is moved to the correct class before
          judging rather than refunded. Any difference in fees is refunded or charged.
        </P>
        <P>
          <B>Withdrawing during the show.</B> Under AQHA rule 52.11 an exhibitor who withdraws after competing forfeits the
          fees for the rest of the show, except where the reason is incapacitating sickness or injury to the exhibitor or
          horse, or serious illness or death in the exhibitor&apos;s family.
        </P>
        <P>
          <B>Unpaid entries.</B> An online entry that is not paid within 48 hours lapses. Nothing is charged, so there is
          nothing to refund.
        </P>
        <P>
          <B>Day membership, ground fee and admin fee.</B> These follow the entry: the day membership and ground fee are
          refunded with a full scratch before entries close, the admin fee is retained, and after entries close they are
          refunded only where this section says so.
        </P>

        <H>Clinics</H>
        <P>
          The club&apos;s clinic rules let it plan clinics confidently, cover its commitments to the clinician and venue, and
          keep things fair for everyone. They are the club&apos;s own rules for changes on your side. What happens when the
          club cancels is covered under &quot;If the club cancels, postpones or changes an event&quot;, and your consumer-law
          rights always apply.
        </P>
        <P>
          <B>Deposits.</B> Up until the deposit deadline shown on the clinic page (2 weeks before the clinic), you can secure
          a rider spot with a non-refundable deposit. The deposit is a fraction of the spot price and covers the costs the
          club commits to as soon as spots are sold. The balance is due by the deposit deadline. If it is not paid by then,
          the club sends two reminder emails over the following 5 days. If the balance is still unpaid 5 days after the
          deadline, your spot is forfeited: it goes to the next person on the waiting list and your deposit is kept.
        </P>
        <P>
          <B>Waiting list.</B> Once all rider spots are filled, a waiting list is created. People on it are offered spots in
          order as spots become available.
        </P>
        <P>
          <B>Full payment.</B> After the deposit deadline, all new bookings must be paid in full at the time of booking.
        </P>
        <P>
          <B>Cancellations.</B> Once you commit to a spot, no refund is issued for a change of mind or because you can no
          longer attend, whether you paid a deposit or the full amount. If you cannot attend, it is your responsibility to
          find someone to take your place: arrange the swap and any payment between yourselves, then tell the club the new
          rider&apos;s name and contact details before the clinic so the booking can be moved. The club does not refund you
          or charge the new rider. The new rider must meet the clinic&apos;s conditions, including membership where it
          applies. If no one takes your place, your payment is forfeited.
        </P>
        <P>
          <B>If the club fills your spot.</B> If the club itself fills your cancelled or forfeited spot from the waiting
          list, the club refunds what you paid above the deposit once the new rider has paid. The deposit is kept.
        </P>
        <P>
          <B>Clinics paid in full up front.</B> Where a clinic requires full payment at booking, the same rules apply: no
          refund once committed, and a replacement rider may take your place.
        </P>
        <P>
          <B>What these rules do not cover.</B> They never apply when the club cancels, moves or cannot provide the clinic,
          or when the club has made a mistake. In those cases everything you paid, including the deposit, is refunded as set
          out below. If the advertised clinician is replaced, you may accept the replacement or cancel for a full refund
          including the deposit. Tell the club within 3 days of being notified, or before the clinic starts if that is
          sooner.
        </P>

        <H>Memberships</H>
        <P>
          <B>Annual membership.</B> You may withdraw an application at any time before the committee decides it, and the fee
          is refunded in full. If the committee declines the application, the fee is refunded in full within 10 business
          days. Once the committee approves it, the membership starts straight away and the fee is not refunded if you
          change your mind or stop using the benefits. If the club cannot provide the membership for the rest of the season,
          for example because the club stops operating, the unused months are refunded pro rata.
        </P>
        <P>
          <B>Joining or renewing at an event checkout.</B> A membership bought together with an event entry covers that
          event. It follows the rules above once the committee decides it, whatever happens to the entry.
        </P>
        <P>
          <B>Day membership.</B> A day membership belongs to the entry it was bought with. If that entry is refunded before
          the event, the day membership is refunded with it. Once the event day has passed, it has been used and is not
          refunded.
        </P>
        <P>
          <B>HCQHA numbers.</B> HCQHA membership numbers have no fee, so nothing is refundable.
        </P>

        <H>Raffle tickets</H>
        <P>
          Raffle ticket sales are final once paid. Tickets cannot be refunded or exchanged because you change your mind, miss
          the draw or do not win. Raffles are fundraising under the NSW Community Gaming Act 2018, and the club runs them in
          the fair and impartial way those rules require.
        </P>
        <P>
          When you choose numbers online they are held for 15 minutes while you pay. If payment is not completed in that
          time the numbers are released to others and nothing is charged, so there is nothing to refund.
        </P>
        <P>
          If the club cancels a raffle before it is drawn, every ticket is refunded in full, to the way it was paid, within
          10 business days. If a prize cannot be awarded as advertised, the club will offer a substitute of equal or greater
          value, or a refund of the tickets to anyone who prefers it.
        </P>
        <P>If you were charged for numbers you did not receive, or charged twice, the club refunds the difference in full.</P>

        <H>Horse number fees</H>
        <P>
          A new or replacement back number costs $5 and is not refunded once the number has been issued, because the number
          is yours for life and the tag has been made. If the entry it was bought with is refunded before the number is
          issued, the $5 is refunded with it. If the club charged the fee by mistake, for example for a horse that already
          had a number, it is refunded in full.
        </P>

        <H>If the club cancels, postpones or changes an event</H>
        <P>
          <B>Cancelled by the club.</B> If the club cancels a show or clinic before it starts, for any reason including
          weather, ground conditions, safety, too few entries or a clinician being unavailable, everything you paid for that
          event is refunded in full: class fees, spot fees, deposits, balances, ground and admin fees, day memberships and
          number fees charged with the entry. Refunds are made within 10 business days. The club may offer a credit as well,
          but you never have to accept one instead of a refund.
        </P>
        <P>
          <B>Postponed or moved.</B> If the event is moved to a new date or venue, you may keep your entry for the new date
          or cancel for a full refund. Tell the club within 7 days of being notified; if the club does not hear from you,
          your entry carries over.
        </P>
        <P>
          <B>Stopped part-way.</B> If a show is stopped during the day, for example by a storm or an unsafe arena, fees for
          classes that did not run are refunded in full. Classes that ran, and classes you had scratched or missed, are not
          refunded.
        </P>
        <P>
          <B>Changes to the program.</B> Replacing a judge, changing the order of classes, combining classes with too few
          entries or changing a clinician&apos;s timetable is not a cancellation and does not earn a refund, unless the
          change means your class or spot is not held at all.
        </P>
        <P>
          <B>Events the law stops.</B> If a government direction, such as a disease-control or public-health order, prevents
          the event, the club refunds what you paid less only the costs it has already spent and cannot recover, which is
          the adjustment the Frustrated Contracts Act 1978 (NSW) allows. The club will tell you the figure and how it was
          worked out.
        </P>
        <P>
          <B>Travel and other costs.</B> The club is not responsible for travel, accommodation, float hire or other costs you
          incur because an event is cancelled or changed, beyond what the Australian Consumer Law requires.
        </P>

        <H>Mistakes and duplicate payments</H>
        <P>
          If you were charged twice, charged the wrong amount or paid for the wrong event, tell the club and the difference is
          refunded in full with no deductions. The same applies to anything the website charged in error. Refunds for
          mistakes are paid within 10 business days of the club confirming the error.
        </P>

        <H>How refunds are paid</H>
        <P>
          <B>Back the way you paid.</B> Refunds go to the card or PayPal account you paid with. The club cannot refund an
          online payment in cash or to a different account. If you paid cash or by bank transfer, the refund is made by bank
          transfer to an account in your name.
        </P>
        <P>
          <B>Timing.</B> The club processes a refund within 10 business days of agreeing to it. Card refunds through Square
          usually show on your statement within 3 to 10 business days after that, and PayPal refunds within 1 to 5 business
          days. The exact timing depends on your bank.
        </P>
        <P>
          <B>Payment-processing costs.</B> Square and PayPal keep their processing fees when a payment is refunded. When a
          refund is the club&apos;s responsibility, such as a cancelled event or a mistake, the club absorbs that cost and
          you receive the full amount. On a show entry scratch the club keeps only the admin fee, as set out above. No other
          deduction is made.
        </P>
        <P>
          <B>Partial refunds.</B> Where only part of a payment is refundable, for example a balance but not the deposit, the
          club refunds that part and tells you how it was worked out.
        </P>
        <P>
          <B>Chargebacks.</B> Please contact the club before asking your bank or PayPal to reverse a payment. A refund
          request is quicker, and a chargeback for a payment this policy says is not refundable will be disputed with these
          terms as evidence.
        </P>

        <H>How to ask for a refund</H>
        <P>
          {email ? (
            <>Email the club at <a href={`mailto:${email}`} style={{ color: "var(--brass)", fontWeight: 700 }}>{email}</a> with:</>
          ) : (
            <>Email the club (the refund email address will be added here shortly; until then, use the club&apos;s usual contact channels) with:</>
          )}
        </P>
        <ul style={{ margin: "0 0 10px", paddingLeft: 22, lineHeight: 1.5 }}>
          <li>your name and the name on the booking</li>
          <li>the event or raffle, and the horse and classes or the spot type</li>
          <li>the date you paid and roughly how much</li>
          <li>why you are asking, with a veterinary or medical certificate where this policy asks for one</li>
        </ul>
        <P>
          The club will reply within 5 business days and, where a refund is due, pay it within 10 business days of that
          reply. A Facebook comment or a message to a committee member&apos;s personal phone may be missed. Email is the
          record both sides can rely on.
        </P>

        <H>Complaints and disputes</H>
        <P>
          If you think the club has not followed this policy or the law, write to the club first; most problems are settled
          in a reply. If you are not satisfied, contact NSW Fair Trading on 13 32 20 or at{" "}
          <a href="https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection" target="_blank" rel="noreferrer" style={{ color: "var(--brass)" }}>nsw.gov.au</a>,
          which gives advice and can help resolve a complaint. If that does not settle it, you can apply to the NSW Civil
          and Administrative Tribunal (NCAT), which hears consumer claims up to $100,000 for a small filing fee.
        </P>
        <P>
          This policy is governed by the law of New South Wales. It does not limit any right you have under the Australian
          Consumer Law or any other law.
        </P>

        <p style={{ fontSize: 12.5, color: "var(--quiet)", marginTop: 24 }}>Policy dated 21 October 2026.</p>
      </main>
    </>
  );
}
