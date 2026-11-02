// Job boards and ATSs the content script runs on without asking (detection + floating button).
// Anything else is scanned on demand from the side panel (activeTab + scripting).
export const JOB_SITES = [
    "https://*.linkedin.com/*",
    "https://*.indeed.com/*",
    "https://*.indeed.ca/*",
    "https://*.glassdoor.com/*",
    "https://*.glassdoor.ca/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://jobs.ashbyhq.com/*",
    "https://*.myworkdayjobs.com/*",
    "https://wellfound.com/*",
    "https://*.smartrecruiters.com/*",
    "https://*.bamboohr.com/careers/*",
    "https://*.workable.com/*",
];
