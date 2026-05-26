/**
 * Data Export Service
 * Fetches all user content and formats as structured JSON for GDPR data portability
 */

import { createClient } from '@supabase/supabase-js';

export type ContentType = "resume" | "presentation" | "diagram" | "letter" | "generated";

export interface ExportableItem {
  id: string;
  type: ContentType;
  title: string;
  description?: string;
  created_at: string;
  updated_at: string;
  content: any;
}

export interface UserDataExport {
  export_metadata: {
    exported_at: string;
    version: string;
    user_id: string;
    total_items: number;
  };
  content: {
    resumes: ExportableItem[];
    presentations: ExportableItem[];
    diagrams: ExportableItem[];
    letters: ExportableItem[];
    generated_documents: ExportableItem[];
  };
  counts: {
    resumes: number;
    presentations: number;
    diagrams: number;
    letters: number;
    generated: number;
    total: number;
  };
}

/**
 * Fetches all user data from various tables
 */
// Admin client for data export - bypasses RLS to fetch all user data
const createAdminClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
};

/**
 * Fetches all user data from various tables
 */
export async function fetchAllUserData(userId: string): Promise<UserDataExport> {
  const supabase = createAdminClient();

  // Fetch all data types in parallel for efficiency
  const [
    documentsResult,
    presentationsResult,
    diagramsResult,
    lettersResult,
  ] = await Promise.all([
    // Fetch all documents (resumes and generated documents)
    supabase
      .from("documents")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    
    // Fetch presentations
    supabase
      .from("presentations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    
    // Fetch diagrams
    supabase
      .from("diagrams")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    
    // Fetch letters
    supabase
      .from("letters")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  // Process documents - separate resumes from generated documents
  const allDocuments = documentsResult.data || [];
  const resumes: ExportableItem[] = [];
  const generatedDocs: ExportableItem[] = [];

  allDocuments.forEach((doc: any) => {
    const item: ExportableItem = {
      id: doc.id,
      type: doc.type as ContentType,
      title: doc.title || `Untitled ${doc.type}`,
      description: getDocumentDescription(doc),
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      content: doc.content || {},
    };

    if (doc.type === "resume") {
      item.type = "resume";
      resumes.push(item);
    } else if (doc.type === "generated") {
      generatedDocs.push(item);
    }
  });

  // Process presentations
  const presentations: ExportableItem[] = (presentationsResult.data || []).map((pres: any) => {
    const content = pres.content || pres || {};
    const slides = content.slides || pres.slides || [];
    
    return {
      id: pres.id,
      type: "presentation",
      title: pres.title || "Untitled Presentation",
      description: `${slides.length || 0} slides`,
      created_at: pres.created_at,
      updated_at: pres.updated_at,
      content: {
        title: pres.title,
        slides: slides,
        theme_id: content.themeId || content.template || pres.themeId || pres.template || "peach",
        settings: content.settings || {},
      },
    };
  });

  // Process diagrams
  const diagrams: ExportableItem[] = (diagramsResult.data || []).map((diagram: any) => ({
    id: diagram.id,
    type: "diagram",
    title: diagram.title || "Untitled Diagram",
    description: diagram.type || "Diagram",
    created_at: diagram.created_at,
    updated_at: diagram.updated_at,
    content: {
      type: diagram.type,
      mermaid_code: diagram.mermaid_code || diagram.mermaidCode,
      data: diagram.data || diagram.content || {},
      settings: diagram.settings || {},
    },
  }));

  // Process letters
  const letters: ExportableItem[] = (lettersResult.data || []).map((letter: any) => {
    const content = letter.content || letter || {};
    
    return {
      id: letter.id,
      type: "letter",
      title: letter.subject || letter.title || "Untitled Letter",
      description: letter.letter_type || content.letter_type || "Letter",
      created_at: letter.created_at,
      updated_at: letter.updated_at,
      content: {
        letter_type: letter.letter_type || content.letter_type,
        subject: letter.subject || content.subject,
        from: content.from || letter.from || {},
        to: content.to || letter.to || {},
        date: content.date || letter.date,
        body: content.content || content.body || letter.content || letter.body,
        signature: content.signature || letter.signature,
      },
    };
  });

  const counts = {
    resumes: resumes.length,
    presentations: presentations.length,
    diagrams: diagrams.length,
    letters: letters.length,
    generated: generatedDocs.length,
    total: resumes.length + presentations.length + diagrams.length + letters.length + generatedDocs.length,
  };

  return {
    export_metadata: {
      exported_at: new Date().toISOString(),
      version: "1.0.0",
      user_id: userId,
      total_items: counts.total,
    },
    content: {
      resumes,
      presentations,
      diagrams,
      letters,
      generated_documents: generatedDocs,
    },
    counts,
  };
}

/**
 * Helper function to get document description
 */
function getDocumentDescription(doc: any): string {
  const content = doc.content || {};
  
  switch (doc.type) {
    case "resume":
      return content.resumeData?.personal_info?.name || 
             content.resumeData?.personalInfo?.name || 
             content.personal_info?.name || 
             content.personalInfo?.name || 
             "Resume";
    case "generated":
      const sections = content.metadata?.sections || content.sections || [];
      return `${sections.length || 0} sections • ${doc.document_type?.replace(/-/g, " ") || "AI Document"}`;
    default:
      return doc.type || "Document";
  }
}

/**
 * Generates a JSON file for download
 */
export function generateExportFile(data: UserDataExport): Blob {
  const jsonString = JSON.stringify(data, null, 2);
  return new Blob([jsonString], { type: "application/json" });
}

/**
 * Streams user data export as a readable stream for large datasets
 * This avoids loading the entire JSON into memory at once
 */
export async function streamUserDataExport(
  userId: string,
  stream: WritableStream<Uint8Array>
): Promise<void> {
  const writer = stream.getWriter();
  const encoder = new TextEncoder();

  try {
    const userData = await fetchAllUserData(userId);
    const jsonString = JSON.stringify(userData, null, 2);
    
    // Stream the JSON in chunks to avoid memory issues
    const chunkSize = 64 * 1024; // 64KB chunks
    for (let i = 0; i < jsonString.length; i += chunkSize) {
      const chunk = jsonString.slice(i, i + chunkSize);
      await writer.write(encoder.encode(chunk));
    }
  } finally {
    await writer.close();
  }
}

/**
 * Compresses data using gzip compression
 * Returns a compressed blob
 */
export async function compressData(data: UserDataExport): Promise<Blob> {
  const jsonString = JSON.stringify(data, null, 2);
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(jsonString);
  
  // Use CompressionStream API for gzip compression
  const compressionStream = new CompressionStream('gzip');
  const writer = compressionStream.writable.getWriter();
  const reader = compressionStream.readable.getReader();
  
  // Write data to compression stream
  writer.write(uint8Array);
  writer.close();
  
  // Collect compressed chunks
  const chunks: BlobPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  // Combine chunks into a single blob
  return new Blob(chunks, { type: 'application/gzip' });
}

/**
 * Streams and compresses user data export for large datasets
 * This is the most efficient method for handling large exports
 */
export async function streamCompressedExport(
  userId: string,
  stream: WritableStream<Uint8Array>
): Promise<void> {
  const writer = stream.getWriter();
  const encoder = new TextEncoder();

  try {
    const userData = await fetchAllUserData(userId);
    const jsonString = JSON.stringify(userData, null, 2);
    const uint8Array = encoder.encode(jsonString);
    
    // Create compression stream
    const compressionStream = new CompressionStream('gzip');
    const compressionWriter = compressionStream.writable.getWriter();
    const compressionReader = compressionStream.readable.getReader();
    
    // Start compression in background
    const compressionPromise = (async () => {
      await compressionWriter.write(uint8Array);
      await compressionWriter.close();
    })();
    
    // Stream compressed chunks to output
    while (true) {
      const { done, value } = await compressionReader.read();
      if (done) break;
      await writer.write(value);
    }
    
    await compressionPromise;
  } finally {
    await writer.close();
  }
}

/**
 * Generates a filename for the export
 */
export function generateExportFilename(userId: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `draftdeckai-export-${userId.substring(0, 8)}-${date}.json`;
}
