import { Client, AccessOptions } from 'basic-ftp';
import * as path from 'path';
import { Readable, Writable } from 'stream';

// FTP configuration from environment variables
const FTP_HOST = process.env.FTP_HOST?.trim();
const FTP_PORT = parseInt(process.env.FTP_PORT?.trim() || '21', 10);
const FTP_USER = process.env.FTP_USER?.trim();
const FTP_PASS = process.env.FTP_PASS?.trim();
const FTP_SECURE = process.env.FTP_SECURE?.trim().toLowerCase() === 'true';
const FTP_BASE_PATH = process.env.FTP_BASE_PATH?.trim() || '/patients';
const FTP_MAX_FILE_SIZE = parseInt(process.env.FTP_MAX_FILE_SIZE?.trim() || '100000000', 10); // 100MB default

// Validate FTP configuration
if (!FTP_HOST || !FTP_USER || !FTP_PASS) {
  console.warn('FTP configuration incomplete. Document upload functionality will not work.');
}

/**
 * Get FTP client with proper configuration
 */
async function getFtpClient(): Promise<Client> {
  if (!FTP_HOST || !FTP_USER || !FTP_PASS) {
    throw new Error('FTP configuration is missing. Please set FTP_HOST, FTP_USER, and FTP_PASS environment variables.');
  }

  const client = new Client();
  client.ftp.verbose = process.env.NODE_ENV === 'development';

  const accessOptions: AccessOptions = {
    host: FTP_HOST,
    port: FTP_PORT,
    user: FTP_USER,
    password: FTP_PASS,
    secure: FTP_SECURE, // Use TLS/SSL
    secureOptions: FTP_SECURE ? {
      rejectUnauthorized: false // Allow self-signed certificates
    } : undefined
  };

  try {
    await client.access(accessOptions);
    return client;
  } catch (error) {
    // Close the client on error to prevent resource leaks
    try {
      client.close();
    } catch (closeError) {
      // Ignore close errors
    }
    
    // Provide helpful error messages
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
        throw new Error(`Cannot connect to FTP server at ${FTP_HOST}:${FTP_PORT}. Please check: 1) Server is running, 2) Port is correct (use 990 for implicit FTPS), 3) Firewall allows connection`);
      } else if (error.message.includes('timeout')) {
        throw new Error(`FTP connection timeout to ${FTP_HOST}:${FTP_PORT}. Please check network connectivity and server status`);
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        throw new Error(`Cannot resolve FTP server hostname: ${FTP_HOST}. Please check FTP_HOST configuration`);
      }
    }
    throw error;
  }
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove path separators and dangerous characters
  const sanitized = filename
    .replace(/[\/\\]/g, '_') // Replace slashes
    .replace(/\.\./g, '_') // Replace parent directory references
    .replace(/[<>:"|?*]/g, '_') // Replace other dangerous characters
    .trim();
  
  // Ensure filename is not empty
  if (!sanitized) {
    throw new Error('Invalid filename');
  }
  
  return sanitized;
}

/**
 * Generate filename in format: {cimke}_{patientId}_{datum}.{kiterjesztes}
 */
export function generateDocumentFilename(
  originalFilename: string,
  tags: string[],
  patientId: string,
  uploadDate: Date = new Date()
): string {
  // Get file extension
  const lastDot = originalFilename.lastIndexOf('.');
  const extension = lastDot >= 0 ? originalFilename.substring(lastDot) : '';
  
  // Use all tags, or "document" as default if no tags
  let normalizedTag = 'document';
  if (tags.length > 0) {
    // Normalize each tag: remove special characters, take first 5 chars, join with underscore
    const normalizedTags = tags
      .map(tag => {
        const normalized = tag
          .replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '')
          .toLowerCase();
        // Take first 5 characters
        return normalized.substring(0, 5);
      })
      .filter(tag => tag.length > 0); // Remove empty tags
    
    if (normalizedTags.length > 0) {
      normalizedTag = normalizedTags.join('_');
    }
  }
  
  console.log('Generating filename with tags:', tags, 'normalized tag:', normalizedTag, 'patientId:', patientId);
  
  // Use patientId directly (UUID format, already safe for filenames)
  const normalizedPatientId = patientId.toLowerCase();
  
  // Format date as YYYY-MM-DD
  const year = uploadDate.getFullYear();
  const month = String(uploadDate.getMonth() + 1).padStart(2, '0');
  const day = String(uploadDate.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  // Build filename: {cimke}_{patientId}_{datum}.{kiterjesztes}
  const newFilename = `${normalizedTag}_${normalizedPatientId}_${dateStr}${extension}`;
  
  // Sanitize the final filename (this will ensure no dangerous characters remain)
  return sanitizeFilename(newFilename);
}

/**
 * Get file path for a patient document on FTP server
 * Note: This returns the path as stored in database. Actual FTP operations
 * handle path normalization in ensurePatientDirectory.
 */
function getPatientFilePath(patientId: string, filename: string): string {
  const sanitizedFilename = sanitizeFilename(filename);
  // Store the path as configured (will be normalized during upload)
  return path.posix.join(FTP_BASE_PATH, patientId, sanitizedFilename);
}

/**
 * Ensure patient directory exists on FTP server
 */
async function ensurePatientDirectory(client: Client, patientId: string): Promise<void> {
  // Get current working directory (this is the FTP user's home/chroot directory)
  let currentDir = '/';
  try {
    currentDir = await client.pwd();
    console.log(`[FTP] Current directory: ${currentDir}`);
  } catch (error) {
    console.warn('Could not get current directory, assuming root');
  }

  // Normalize the base path
  // If FTP_BASE_PATH is absolute and starts with currentDir, strip it to make it relative
  // This handles chrooted FTP servers where absolute paths don't work
  let basePath = FTP_BASE_PATH.trim();
  
  // Remove trailing slashes
  while (basePath.endsWith('/')) {
    basePath = basePath.slice(0, -1);
  }
  
  // Normalize currentDir (remove trailing slash for comparison)
  let normalizedCurrentDir = currentDir;
  while (normalizedCurrentDir.endsWith('/') && normalizedCurrentDir.length > 1) {
    normalizedCurrentDir = normalizedCurrentDir.slice(0, -1);
  }
  
  console.log(`[FTP] FTP_BASE_PATH: ${FTP_BASE_PATH}, normalized: ${basePath}`);
  console.log(`[FTP] Current dir: ${currentDir}, normalized: ${normalizedCurrentDir}`);
  
  if (basePath.startsWith('/')) {
    // If base path starts with current directory, make it relative
    if (normalizedCurrentDir !== '/' && basePath.startsWith(normalizedCurrentDir + '/')) {
      basePath = basePath.substring(normalizedCurrentDir.length + 1); // +1 to skip the slash
      console.log(`[FTP] Converted absolute path to relative: ${basePath}`);
    } else if (normalizedCurrentDir !== '/' && basePath === normalizedCurrentDir) {
      // Exact match
      basePath = '';
      console.log(`[FTP] Base path matches current dir, using empty string`);
    } else if (basePath === '/') {
      basePath = '';
    } else {
      // Absolute path that doesn't start with currentDir
      // Try to find common prefix and make it relative
      const baseParts = basePath.split('/').filter(p => p);
      const currentParts = normalizedCurrentDir.split('/').filter(p => p);
      
      // Find how many parts match from the beginning
      let matchingParts = 0;
      for (let i = 0; i < Math.min(baseParts.length, currentParts.length); i++) {
        if (baseParts[i] === currentParts[i]) {
          matchingParts++;
        } else {
          break;
        }
      }
      
      if (matchingParts > 0 && matchingParts === currentParts.length) {
        // All current dir parts match, use remaining base parts
        basePath = baseParts.slice(matchingParts).join('/');
        console.log(`[FTP] Found common prefix, converted to relative: ${basePath}`);
      } else if (normalizedCurrentDir === '/' && baseParts.length > 0) {
        // If we're at root and basePath is absolute, we're likely in a chrooted environment
        // Extract the relevant part - typically the last directory or directories
        // For FTP_BASE_PATH=/home/jancsi/ftp/rehab_prot/patients, extract "patients"
        console.warn(`[FTP] Warning: At root (/), absolute path ${basePath} detected. Assuming chrooted environment.`);
        // Use the last directory name as the relative path
        // This works when FTP_BASE_PATH ends with the directory we want (e.g., .../patients)
        const lastPart = baseParts[baseParts.length - 1];
        console.log(`[FTP] Extracting last directory name as relative path: ${lastPart}`);
        basePath = lastPart;
      } else {
        // No match - this will likely fail, but log a warning
        console.warn(`[FTP] Warning: Absolute path ${basePath} doesn't match current dir ${normalizedCurrentDir}, will try as-is`);
      }
    }
  }
  
  // Build patient directory path (relative to current directory)
  const patientDir = basePath 
    ? path.posix.join(basePath, patientId)
    : patientId;
  
  console.log(`[FTP] Patient directory path: ${patientDir}`);
  
  try {
    // Use ensureDir which creates parent directories if needed
    // ensureDir works with relative paths from current directory
    await client.ensureDir(patientDir);
    console.log(`[FTP] Successfully created directory: ${patientDir}`);
  } catch (error) {
    console.error(`[FTP] ensureDir failed, trying step-by-step:`, error);
    // If ensureDir fails, try creating directories one by one
    const parts = patientDir.split('/').filter(p => p && p !== '.');
    console.log(`[FTP] Path parts:`, parts);
    
    // Make sure we're in the current directory before starting
    try {
      await client.cd(currentDir);
    } catch (cdError) {
      console.warn(`[FTP] Could not cd to ${currentDir}, continuing`);
    }
    
    let builtPath = '';
    
    for (const part of parts) {
      const nextPath = builtPath ? path.posix.join(builtPath, part) : part;
      console.log(`[FTP] Processing part: ${part}, nextPath: ${nextPath}, builtPath: ${builtPath}`);
      
      try {
        // Try to cd into the directory (check if exists)
        await client.cd(nextPath);
        builtPath = nextPath;
        console.log(`[FTP] Directory ${nextPath} already exists`);
      } catch (cdError) {
        // Directory doesn't exist or we can't access it, try to create it
        console.log(`[FTP] Directory ${nextPath} doesn't exist or inaccessible, attempting to create...`);
        try {
          // Make sure we're in the parent directory
          if (builtPath) {
            try {
              await client.cd(builtPath);
              console.log(`[FTP] Changed to parent directory: ${builtPath}`);
            } catch (parentCdError) {
              console.warn(`[FTP] Could not cd to parent ${builtPath}, trying from root`);
              await client.cd(currentDir);
            }
          }
          
          // Try to create the directory
          try {
            await client.send(`MKD ${part}`);
            // Wait a bit for the response
            await new Promise(resolve => setTimeout(resolve, 200));
            console.log(`[FTP] MKD command sent for ${part}`);
          } catch (mkdError) {
            // MKD might fail if directory already exists or no permission
            // Check if we can cd into it now (maybe it was created by another process)
            console.warn(`[FTP] MKD failed for ${part}, checking if it exists now:`, mkdError);
          }
          
          // Try to cd into it to verify it exists
          try {
            await client.cd(nextPath);
            builtPath = nextPath;
            console.log(`[FTP] Successfully verified directory exists: ${nextPath}`);
          } catch (verifyError) {
            // If we still can't cd, check if this is the base directory or patient directory
            const isLastPart = parts.indexOf(part) === parts.length - 1;
            const isBaseDirectory = parts.indexOf(part) === 0;
            
            if (isLastPart) {
              // This is the patient directory - we must be able to create it
              throw new Error(`Failed to create patient directory ${part}: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`);
            } else if (isBaseDirectory) {
              // Base directory creation failed - it might exist but we don't have permission to create it
              // Try to use the full path directly for the patient directory
              console.warn(`[FTP] Base directory ${part} creation failed, trying to create patient directory with full path`);
              // Don't update builtPath, we'll try the full path approach
            } else {
              // Intermediate directory - try to continue
              console.warn(`[FTP] Could not verify directory ${part}, assuming it exists`);
              builtPath = nextPath;
            }
          }
        } catch (createError) {
          // If this is the patient directory (last part), we must fail
          if (parts.indexOf(part) === parts.length - 1) {
            console.error(`[FTP] Failed to create patient directory ${part}:`, createError);
            throw new Error(`Failed to create patient directory ${part}: ${createError instanceof Error ? createError.message : 'Unknown error'}`);
          } else {
            // For base directories, if creation fails, assume it exists and continue
            console.warn(`[FTP] Could not create base directory ${part}, assuming it exists:`, createError);
            // Try to continue - if we can't cd into it, we'll try the full path for patient directory
            try {
              await client.cd(nextPath);
              builtPath = nextPath;
            } catch {
              // Can't cd, but continue anyway - we'll try full path for patient dir
              builtPath = nextPath;
            }
          }
        }
      }
    }
    
    // Final verification: try to cd into the final patient directory
    try {
      await client.cd(patientDir);
      console.log(`[FTP] Successfully verified final patient directory: ${patientDir}`);
    } catch (finalError) {
      // If we still can't access it, try one more time to create just the patient directory
      console.warn(`[FTP] Final directory verification failed, trying direct creation:`, finalError);
      const patientDirParts = patientDir.split('/').filter(p => p);
      const patientDirName = patientDirParts[patientDirParts.length - 1];
      const parentPath = patientDirParts.slice(0, -1).join('/');
      
      try {
        if (parentPath) {
          await client.cd(parentPath);
        } else {
          await client.cd(currentDir);
        }
        await client.send(`MKD ${patientDirName}`);
        await new Promise(resolve => setTimeout(resolve, 200));
        await client.cd(patientDir);
        console.log(`[FTP] Successfully created patient directory using direct method`);
      } catch (directError) {
        throw new Error(`Failed to create patient directory ${patientDir}: ${directError instanceof Error ? directError.message : 'Unknown error'}`);
      }
    }
  }
}

/**
 * Upload a file to FTP server for a patient
 * @param patientId Patient UUID
 * @param fileBuffer File buffer
 * @param filename Original filename
 * @returns FTP file path
 */
export async function uploadFile(
  patientId: string,
  fileBuffer: Buffer,
  filename: string
): Promise<string> {
  // Validate file size
  if (fileBuffer.length > FTP_MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${FTP_MAX_FILE_SIZE} bytes`);
  }

  if (fileBuffer.length === 0) {
    throw new Error('File is empty');
  }

  const client = await getFtpClient();
  
  try {
    // Ensure patient directory exists (this also navigates to the patient directory)
    await ensurePatientDirectory(client, patientId);
    
    // Get sanitized filename (we're already in the patient directory, so use relative path)
    const sanitizedFilename = sanitizeFilename(filename);
    
    // Upload file using just the filename (we're already in the patient directory)
    const stream = Readable.from(fileBuffer);
    await client.uploadFrom(stream, sanitizedFilename);
    
    // Return the full path for database storage (but we uploaded using relative path)
    const filePath = getPatientFilePath(patientId, filename);
    return filePath;
  } catch (error) {
    console.error('FTP upload error:', error);
    throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.close();
  }
}

/**
 * Download a file from FTP server
 * @param filePath FTP file path (full path from database)
 * @param patientId Optional patient ID to navigate to patient directory
 * @returns File buffer
 */
export async function downloadFile(filePath: string, patientId?: string): Promise<Buffer> {
  const client = await getFtpClient();
  
  try {
    // Validate path doesn't contain path traversal
    if (filePath.includes('..')) {
      throw new Error('Invalid file path');
    }

    // Extract filename from file_path
    // file_path format: /home/jancsi/ftp/rehab_prot/patients/{patientId}/{filename}
    // or relative: patients/{patientId}/{filename}
    let filename = filePath;
    
    // If file_path contains the patient directory, extract just the filename
    if (patientId && filePath.includes(patientId)) {
      const parts = filePath.split('/');
      filename = parts[parts.length - 1]; // Get last part (filename)
    } else if (filePath.includes('/')) {
      // Extract filename from path
      filename = filePath.split('/').pop() || filePath;
    }
    
    console.log(`[FTP] Downloading file: ${filename} from path: ${filePath}`);
    
    const chunks: Buffer[] = [];
    
    const writable = new Writable({
      write(chunk: Buffer, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    // Navigate to patient directory if patientId is provided
    if (patientId) {
      await ensurePatientDirectory(client, patientId);
      // Now we're in the patient directory, use relative filename
      await client.downloadTo(writable, filename);
    } else {
      // Try to use full path (for backward compatibility)
      await client.downloadTo(writable, filePath);
    }
    
    console.log(`[FTP] Successfully downloaded file: ${filename}, size: ${Buffer.concat(chunks).length} bytes`);
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('FTP download error:', error);
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.close();
  }
}

/**
 * Delete a file from FTP server
 * @param filePath FTP file path
 */
export async function deleteFile(filePath: string, patientId?: string): Promise<void> {
  const client = await getFtpClient();
  
  try {
    // Validate path doesn't contain path traversal
    if (filePath.includes('..')) {
      throw new Error('Invalid file path');
    }

    // Extract filename from file_path
    // file_path format: /home/jancsi/ftp/rehab_prot/patients/{patientId}/{filename}
    // or relative: patients/{patientId}/{filename}
    let filename = filePath;
    
    // If file_path contains the patient directory, extract just the filename
    if (patientId && filePath.includes(patientId)) {
      const parts = filePath.split('/');
      filename = parts[parts.length - 1]; // Get last part (filename)
    } else if (filePath.includes('/')) {
      // Extract filename from path
      filename = filePath.split('/').pop() || filePath;
    }
    
    console.log(`[FTP] Deleting file: ${filename} from path: ${filePath}`);
    
    // Navigate to patient directory if patientId is provided
    if (patientId) {
      await ensurePatientDirectory(client, patientId);
      // Now we're in the patient directory, use relative filename
      await client.remove(filename);
    } else {
      // Try to use full path (for backward compatibility)
      await client.remove(filePath);
    }
    
    console.log(`[FTP] Successfully deleted file: ${filename}`);
  } catch (error) {
    console.error('FTP delete error:', error);
    // If file doesn't exist, that's okay (idempotent)
    if (error instanceof Error && !error.message.includes('not found') && !error.message.includes('No such file')) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  } finally {
    client.close();
  }
}

/**
 * List files for a patient
 * @param patientId Patient UUID
 * @returns Array of file info
 */
export async function listFiles(patientId: string): Promise<Array<{ name: string; size: number; modifiedAt: Date }>> {
  const client = await getFtpClient();
  
  try {
    const patientDir = path.posix.join(FTP_BASE_PATH, patientId);
    
    const files = await client.list(patientDir);
    
    return files
      .filter(file => file.type === 1) // Only files, not directories
      .map(file => ({
        name: file.name,
        size: file.size || 0,
        modifiedAt: file.modifiedAt || new Date()
      }));
  } catch (error) {
    console.error('FTP list error:', error);
    // If directory doesn't exist, return empty array
    if (error instanceof Error && (error.message.includes('not found') || error.message.includes('No such file'))) {
      return [];
    }
    throw new Error(`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.close();
  }
}

/**
 * Check if FTP is configured
 */
export function isFtpConfigured(): boolean {
  return !!(FTP_HOST && FTP_USER && FTP_PASS);
}

/**
 * Get maximum file size allowed
 */
export function getMaxFileSize(): number {
  return FTP_MAX_FILE_SIZE;
}

