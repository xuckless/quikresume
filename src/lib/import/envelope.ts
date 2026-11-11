// src/lib/import/envelope.ts
// The structured import shape, before validation: what the import model is asked to reply with
// (RESUME_JSON_SHAPE in prompt.ts) and what the browser extension builds from a LinkedIn profile page
// (extension/lib/profile-extract.ts). parseImportObject (parsed-resume.ts) validates it leniently into a
// ResumeData draft. Types only and no imports: the extension imports this file by relative path.

export interface ImportEnvelope {
    personalInfo?: Partial<Record<"firstName" | "lastName" | "name" | "headline" | "email" | "phone" | "location" | "github" | "linkedin" | "website" | "summary", string>>;
    links?: { label: string; url: string }[];
    workExperience?: { title: string; company: string; startDate: string; endDate: string; bullets: string[] }[];
    education?: { degree: string; institution: string; startDate: string; endDate: string; gpa?: string; minor?: string; details?: string }[];
    skills?: { category: string; items: string[] }[];
    projects?: { title: string; stack?: string; link?: string; startDate: string; endDate: string; bullets: string[] }[];
    certifications?: { name: string; issuer: string; year: string; credentialId?: string; expires?: string }[];
    awards?: { title: string; issuer: string; date: string; description: string }[];
    volunteering?: { role: string; organization: string; startDate: string; endDate: string; bullets: string[] }[];
    publications?: { title: string; venue: string; date: string; link: string; authors?: string }[];
    languages?: { language: string; proficiency: string }[];
    custom?: { section: string; title: string; subtitle: string; startDate: string; endDate: string; bullets: string[] }[];
}
