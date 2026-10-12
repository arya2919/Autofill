// Flattens the stored profile into the "answers" dictionary the content script uses.
// Booleans (workAuth, sponsorship, relocate) are real booleans; "" means "don't fill".

const s = (v) => (v === undefined || v === null ? '' : String(v).trim());

function triBool(v) {
  if (v === true || v === 'yes' || v === 'Yes' || v === 'true') return true;
  if (v === false || v === 'no' || v === 'No' || v === 'false') return false;
  return null; // unknown -> never fill
}

export function buildAnswers(payload) {
  const p = (payload && payload.profile) || {};
  const per = p.personal || {};
  const adr = p.address || {};
  const lnk = p.links || {};
  const wrk = p.work || {};
  const edu = p.education || {};
  const elg = p.eligibility || {};
  const eeo = p.eeo || {};

  const first = s(per.firstName);
  const last = s(per.lastName);
  const cc = s(per.phoneCountryCode);
  const national = s(per.phone);
  const international = [cc, national].filter(Boolean).join(' ');
  const location = [s(adr.city), s(adr.state), s(adr.country)].filter(Boolean).join(', ');

  return {
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(' '),
    preferredName: s(per.preferredName) || first,
    email: s(per.email),
    emailConfirm: s(per.email),
    phone: national || international,
    phoneInternational: international || national,
    phoneCountryCode: cc,

    addressLine1: s(adr.line1),
    addressLine2: s(adr.line2),
    addressLine3: s(adr.line3),
    city: s(adr.city),
    state: s(adr.state),
    postalCode: s(adr.postalCode),
    country: s(adr.country),
    location,

    linkedin: s(lnk.linkedin),
    github: s(lnk.github),
    twitter: s(lnk.twitter),
    portfolio: s(lnk.portfolio) || s(lnk.website),
    website: s(lnk.website) || s(lnk.portfolio),
    anyUrl: s(lnk.website) || s(lnk.portfolio) || s(lnk.linkedin) || s(lnk.github),

    currentCompany: s(wrk.currentCompany),
    currentTitle: s(wrk.currentTitle),
    yearsExperience: s(wrk.yearsExperience),
    noticePeriod: s(wrk.noticePeriod),
    currentSalary: s(wrk.currentSalary),
    expectedSalary: s(wrk.expectedSalary),
    startDate: s(wrk.startDate),

    school: s(edu.school),
    degree: s(edu.degree),
    fieldOfStudy: s(edu.fieldOfStudy),
    gradYear: s(edu.gradYear),
    gpa: s(edu.gpa),

    summary: s(p.summary),
    coverLetter: s(payload && payload.drafts && payload.drafts.coverLetter),

    workAuth: triBool(elg.authorizedToWork),
    sponsorship: triBool(elg.requiresSponsorship),
    relocate: triBool(elg.willingToRelocate),
    previousEmployee: triBool(elg.workedForCompanyBefore),
    referralSource: s(elg.referralSource),

    gender: s(eeo.gender),
    ethnicity: s(eeo.ethnicity),
    veteran: s(eeo.veteran),
    disability: s(eeo.disability),

    // work history, newest first: used for repeated "Company / Job title / Role description" blocks
    experience: Array.isArray(p.experience)
      ? p.experience.map((e) => ({
          company: s(e && e.company),
          title: s(e && e.title),
          description: e && Array.isArray(e.bullets) && e.bullets.length
            ? e.bullets.map((b) => '• ' + s(b).replace(/^[•\-*]\s*/, '')).join('\n')
            : s(e && e.description)
        }))
      : [],

    customAnswers: Array.isArray(p.customAnswers)
      ? p.customAnswers.filter((c) => c && c.match && c.answer !== undefined).map((c) => ({ match: String(c.match), answer: String(c.answer) }))
      : []
  };
}
