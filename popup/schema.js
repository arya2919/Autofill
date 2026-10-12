// Declarative description of the Profile form. Paths point into payload.profile.
// type: text | email | tel | url | number | textarea | tri (Yes/No/blank) | tags (comma separated -> array)

export const SECTIONS = [
  { title: 'Personal', fields: [
    { path: 'personal.firstName', label: 'First name' },
    { path: 'personal.lastName', label: 'Last name' },
    { path: 'personal.preferredName', label: 'Preferred name (optional)' },
    { path: 'personal.email', label: 'Email', type: 'email' },
    { path: 'personal.phoneCountryCode', label: 'Phone country code', placeholder: '+91' },
    { path: 'personal.phone', label: 'Phone (without country code)', type: 'tel' }
  ] },
  { title: 'Address', fields: [
    { path: 'address.line1', label: 'Address line 1' },
    { path: 'address.line2', label: 'Address line 2' },
    { path: 'address.line3', label: 'Address line 3 (optional)' },
    { path: 'address.city', label: 'City' },
    { path: 'address.state', label: 'State / Province' },
    { path: 'address.postalCode', label: 'PIN / ZIP code' },
    { path: 'address.country', label: 'Country', placeholder: 'India' }
  ] },
  { title: 'Links', fields: [
    { path: 'links.linkedin', label: 'LinkedIn URL', type: 'url' },
    { path: 'links.github', label: 'GitHub URL', type: 'url' },
    { path: 'links.portfolio', label: 'Portfolio URL', type: 'url' },
    { path: 'links.website', label: 'Personal website', type: 'url' },
    { path: 'links.twitter', label: 'Twitter / X URL', type: 'url' }
  ] },
  { title: 'Work', fields: [
    { path: 'work.currentCompany', label: 'Current / last company' },
    { path: 'work.currentTitle', label: 'Current / last job title' },
    { path: 'work.yearsExperience', label: 'Total years of experience', type: 'number' },
    { path: 'work.noticePeriod', label: 'Notice period', placeholder: '30 days' },
    { path: 'work.currentSalary', label: 'Current salary / CTC' },
    { path: 'work.expectedSalary', label: 'Expected salary / CTC' },
    { path: 'work.startDate', label: 'Earliest start date', placeholder: 'Immediately' }
  ] },
  { title: 'Education', fields: [
    { path: 'education.school', label: 'University / College' },
    { path: 'education.degree', label: 'Degree', placeholder: "Bachelor's" },
    { path: 'education.fieldOfStudy', label: 'Field of study' },
    { path: 'education.gradYear', label: 'Graduation year', type: 'number' },
    { path: 'education.gpa', label: 'GPA / CGPA' }
  ] },
  { title: 'Eligibility questions', fields: [
    { path: 'eligibility.authorizedToWork', label: 'Authorized to work in the country you apply to?', type: 'tri' },
    { path: 'eligibility.requiresSponsorship', label: 'Require visa sponsorship?', type: 'tri' },
    { path: 'eligibility.willingToRelocate', label: 'Willing to relocate?', type: 'tri' },
    { path: 'eligibility.workedForCompanyBefore', label: 'Ever worked for the company you apply to (or its subsidiaries)?', type: 'tri' },
    { path: 'eligibility.referralSource', label: '"How did you hear about us?" answer', placeholder: 'LinkedIn' }
  ] },
  { title: 'Voluntary self-identification (optional)', note: 'Leave blank to never fill. Type "decline" to pick "Decline to self-identify" options.', fields: [
    { path: 'eeo.gender', label: 'Gender' },
    { path: 'eeo.ethnicity', label: 'Race / ethnicity' },
    { path: 'eeo.veteran', label: 'Veteran status' },
    { path: 'eeo.disability', label: 'Disability status' }
  ] },
  { title: 'About you', fields: [
    { path: 'summary', label: 'Professional summary', type: 'textarea' },
    { path: 'skills', label: 'Skills (comma separated)', type: 'tags' }
  ] }
];

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

export const EXAMPLE_ADVANCED = {
  experience: [
    {
      company: 'Acme Corp',
      title: 'Software Engineer',
      start: '2022-06',
      end: 'Present',
      bullets: [
        'Reduced API p95 latency by 40% by introducing Redis caching in Node.js services',
        'Led migration of a monolith to microservices on AWS, cutting deploy time from 2 hours to 10 minutes'
      ]
    }
  ],
  customAnswers: [
    { match: 'pronouns?', answer: 'he/him' },
    { match: 'why (do you want|are you interested)', answer: 'I am excited by the product and the engineering culture.' }
  ]
};
