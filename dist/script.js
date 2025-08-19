// FFmpeg instance
let ffmpeg = null;
let currentVideoFile = null;
let extractedAudioBlob = null;

let isFFmpegLoaded = false;
let currentAudioURL = null;
let currentVideoURL = null;
let initTimer = null;
let initStartTime = null;

// Blob URL registry for better management
const blobURLRegistry = new Map();

// DOM elements
const videoInput = document.getElementById('videoInput');
const uploadArea = document.getElementById('uploadArea');
const videoPreview = document.getElementById('videoPreview');
const videoElement = document.getElementById('videoElement');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const duration = document.getElementById('duration');
const conversionSection = document.getElementById('conversionSection');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const logOutput = document.getElementById('logOutput');
const resultSection = document.getElementById('resultSection');
const audioElement = document.getElementById('audioElement');
const downloadBtn = document.getElementById('downloadBtn');
const convertBtn = document.getElementById('convertBtn');

const refreshBtn = document.getElementById('refreshBtn');
const uploadBtn = document.getElementById('uploadBtn');
const initMessage = document.getElementById('initMessage');
const timerElement = document.getElementById('timer');

// Timer functions
function startInitTimer() {
    initStartTime = Date.now();
    initTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - initStartTime) / 1000);
        timerElement.textContent = elapsed + 's';
    }, 1000);
}

function stopInitTimer() {
    if (initTimer) {
        clearInterval(initTimer);
        initTimer = null;
    }
}

// Handle upload button click
function handleUploadClick() {
    if (!isFFmpegLoaded) {
        alert('Please wait for FFmpeg initialization to complete before uploading files!');
        return;
    }
    document.getElementById('videoInput').click();
}

// Utility function to add log messages
function addLog(message) {
    if (logOutput) {
        logOutput.textContent += message + '\n';
        logOutput.scrollTop = logOutput.scrollHeight;
    }
    console.log(message);
}

// Initialize application
async function initApp() {
    try {
        progressText.textContent = 'Loading FFmpeg...';
        logOutput.textContent = 'Initializing FFmpeg.wasm...\n';
        
        // Check if FFmpeg is available
        if (typeof FFmpeg === 'undefined') {
            throw new Error('FFmpeg library not loaded. Please check your internet connection.');
        }
        
        // Create FFmpeg instance (version 0.11.6)
        const { createFFmpeg, fetchFile } = FFmpeg;
        
        ffmpeg = createFFmpeg({
            log: true,
            corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
            wasmPath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.wasm',
            workerPath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.worker.js'
        });
        
        // Set log callback
        ffmpeg.setLogger(({ message }) => {
            logOutput.textContent += message + '\n';
            logOutput.scrollTop = logOutput.scrollHeight;
            
            console.log(message)

        });

        // Set progress callback
        ffmpeg.setProgress(({ ratio }) => {
            const percent = Math.round(ratio * 100);
            progressFill.style.width = percent + '%';
            progressText.textContent = `Processing... ${percent}%`;
        });

        // Load FFmpeg with timeout
        addLog('Loading FFmpeg core files...');
        const loadPromise = ffmpeg.load();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('FFmpeg loading timeout (5min)')), 300000);
        });
        
        await Promise.race([loadPromise, timeoutPromise]);
        isFFmpegLoaded = true;
        uploadBtn.disabled = false;
        stopInitTimer();
        initMessage.style.display = 'none';
        logOutput.textContent += 'FFmpeg loaded successfully!\n';
        console.log('FFmpeg loaded successfully');
        
    } catch (error) {
        console.log('FFmpeg initialization failed:', error);
        // Stop timer and show progress section to display error
        stopInitTimer();
        progressSection.style.display = 'block';
        setProgressError();
        progressText.textContent = 'FFmpeg initialization failed! Please check your network connection or try a different browser.';
        // show refresh buttons for FFmpeg init failure
        refreshBtn.style.display = 'block';
        
        // Detailed error information
        let errorMessage = 'FFmpeg initialization failed. Possible causes:\n';
        errorMessage += '1. Network connection issues, unable to load FFmpeg library\n';
        errorMessage += '2. Browser does not support WebAssembly\n';
        errorMessage += '3. Browser security policy restrictions\n';
        errorMessage += '4. Insufficient memory\n\n';
        errorMessage += 'Primary error: ' + error.message;
        
        addLog(errorMessage);
    }
}



// File upload handling
videoInput.addEventListener('change', handleFileSelect);

// Audio format change handling


// Drag and drop upload
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    if (!isFFmpegLoaded) {
        alert('Please wait for FFmpeg initialization to complete before uploading files!');
        return;
    }
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
});

// Handle file selection
function handleFileSelect(event) {
    if (!isFFmpegLoaded) {
        alert('Please wait for FFmpeg initialization to complete before uploading files!');
        event.target.value = ''; // Clear the file input
        return;
    }
    
    const file = event.target.files[0];
    if (file) {
        processFile(file);
    }
}

// Process file
async function processFile(file) {
    // Validate file type
    if (!file.type.startsWith('video/')) {
        alert('Please select a video file!');
        return;
    }

    // Clear previous operation states
    clearPreviousStates();

    currentVideoFile = file;

    // Display file information
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    // Clean up previous video URL if exists
    if (currentVideoURL) {
        revokeSafeBlobURL(currentVideoURL);
        currentVideoURL = null;
    }
    
    // Reset video element first
    videoElement.src = '';
    videoElement.load();
    
    // Create video URL and display preview
    currentVideoURL = createSafeBlobURL(file, 'video-preview');
    if (!currentVideoURL) {
        alert('Failed to create video preview');
        return;
    }
    
    // Set video source with enhanced error handling
    videoElement.addEventListener('error', function videoErrorHandler(e) {
        console.error('Video element error:', e);
        console.error('Error details:', e.target.error);
        
        // Try to recreate the blob URL if it failed
        if (e.target.error && e.target.error.code === e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED) {
            console.log('Attempting to recreate video blob URL...');
            setTimeout(() => {
                if (currentVideoURL) {
                    revokeSafeBlobURL(currentVideoURL);
                }
                currentVideoURL = createSafeBlobURL(file, 'video-preview-retry');
                if (currentVideoURL) {
                    videoElement.src = currentVideoURL;
                    markBlobURLAccessed(currentVideoURL);
                }
            }, 100);
        }
        
        videoElement.removeEventListener('error', videoErrorHandler);
    }, { once: true });
    
    // Add load event listener for success tracking
    videoElement.addEventListener('loadstart', function videoLoadHandler() {
        console.log('Video loading started successfully');
        markBlobURLAccessed(currentVideoURL);
        videoElement.removeEventListener('loadstart', videoLoadHandler);
    }, { once: true });
    
    videoElement.src = currentVideoURL;
    markBlobURLAccessed(currentVideoURL);
    
    // Get video duration and audio info
    videoElement.addEventListener('loadedmetadata', async () => {
        const videoDuration = videoElement.duration;
        duration.textContent = formatTime(videoDuration);
        
        // Initialize timeline and slider functionality
        createTimelineTicks(videoDuration);
        const timeSlider = initializeTimeSlider(videoDuration);
        
        // Store slider reference for later use
        videoElement.timeSlider = timeSlider;
        
        // Initialize progress indicator at video start position
        updateProgressIndicator(0, videoDuration);
        
        // Add video progress tracking
        videoElement.addEventListener('timeupdate', () => {
            updateProgressIndicator(videoElement.currentTime, videoDuration);
        });
        

        
        console.log('Video timeline and slider initialized');
    });
    
    // Show preview and conversion options
    videoPreview.style.display = 'block';
    conversionSection.style.display = 'block';
    
    // Hide other sections
    progressSection.style.display = 'none';
    resultSection.style.display = 'none';
}



// Default bitrates for different audio formats
const defaultBitrates = {
    mp3: '192k',
    aac: '256k',
    wav: '1411k'
};



// Convert video
async function convertVideo() {
    if (!currentVideoFile || !isFFmpegLoaded) {
        alert('Please select a video file and wait for FFmpeg to load');
        return;
    }

    try {
        // Disable convert button
        convertBtn.disabled = true;
        convertBtn.innerHTML = '<div class="loading"></div>Processing...';

        // Show progress section
        progressSection.style.display = 'block';
        resultSection.style.display = 'none';

        // Reset progress and state
        resetProgressState();
        progressText.textContent = 'Preparing conversion...';
        logOutput.textContent = 'Starting audio extraction...\n';
        
        // Get settings
        const audioFormat = document.getElementById('audioFormat').value;
        const audioBitrate = defaultBitrates[audioFormat];
        
        // Get time range settings
        const startTimeInput = document.getElementById('startTime');
        const endTimeInput = document.getElementById('endTime');
        const startTime = parseTimeInput(startTimeInput.value);
        const endTime = parseTimeInput(endTimeInput.value);
        const duration = endTime - startTime;
        
        logOutput.textContent += `Using audio format: ${audioFormat.toUpperCase()}, bitrate: ${audioBitrate}\n`;
        logOutput.textContent += `Time range: ${formatTime(startTime)} - ${formatTime(endTime)} (duration: ${formatTime(duration)})\n`;

        // Generate input and output file names
        const inputFileName = 'input.' + currentVideoFile.name.split('.').pop();
        const outputFileName = `output.${audioFormat}`;

        // Write file to FFmpeg file system
        progressText.textContent = 'Reading video file...';
        const { fetchFile } = FFmpeg;
        ffmpeg.FS('writeFile', inputFileName, await fetchFile(currentVideoFile));

        // Build FFmpeg command with time range
        const command = [
            '-ss', startTime.toString(), // Start time in seconds
            '-i', inputFileName,
            '-t', duration.toString(), // Duration in seconds
            '-vn', // No video
            '-acodec', audioFormat === 'mp3' ? 'libmp3lame' : audioFormat === 'aac' ? 'aac' : 'pcm_s16le',
            '-ab', audioBitrate,
            '-ar', '44100', // Sample rate
            '-y', // Overwrite output file
            outputFileName
        ];

        logOutput.textContent += `Executing command: ffmpeg ${command.join(' ')}\n`;

        // Execute conversion
        logOutput.textContent += 'Starting FFmpeg conversion...\n';
        await ffmpeg.run(...command);
        
        // Check if output file exists
        let data;
        try {
            data = ffmpeg.FS('readFile', outputFileName);
            if (!data || data.length === 0) {
                throw new Error('Output file is empty or does not exist');
            }
        } catch (fileError) {
            throw new Error(`Unable to read output file: ${fileError.message}`);
        }

        // Successfully read output file
        progressText.textContent = 'Generating audio file...';
        logOutput.textContent += `Successfully generated audio file, size: ${formatFileSize(data.length)}\n`;
        
        // Clean up previous audio URL if exists
        if (currentAudioURL) {
            revokeSafeBlobURL(currentAudioURL);
            currentAudioURL = null;
        }
        
        // Reset audio element first
        audioElement.src = '';
        audioElement.load();
        
        // Create audio Blob
        const mimeType = getAudioMimeType(audioFormat);
        extractedAudioBlob = new Blob([data.buffer], { type: mimeType });
        
        // Display results
        currentAudioURL = createSafeBlobURL(extractedAudioBlob, 'audio-result');
        if (!currentAudioURL) {
            throw new Error('Failed to create audio blob URL');
        }
        
        // Set audio source with enhanced error handling
        audioElement.addEventListener('error', function audioErrorHandler(e) {
            console.error('Audio element error:', e);
            console.error('Error details:', e.target.error);
            
            // Try to recreate the blob URL if it failed
            if (e.target.error && e.target.error.code === e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                console.log('Attempting to recreate audio blob URL...');
                setTimeout(() => {
                    if (currentAudioURL) {
                        revokeSafeBlobURL(currentAudioURL);
                    }
                    currentAudioURL = createSafeBlobURL(extractedAudioBlob, 'audio-result-retry');
                    if (currentAudioURL) {
                        audioElement.src = currentAudioURL;
                        markBlobURLAccessed(currentAudioURL);
                    }
                }, 100);
            }
            
            audioElement.removeEventListener('error', audioErrorHandler);
        }, { once: true });
        
        // Add load event listener for success tracking
        audioElement.addEventListener('loadstart', function audioLoadHandler() {
            console.log('Audio loading started successfully');
            markBlobURLAccessed(currentAudioURL);
            audioElement.removeEventListener('loadstart', audioLoadHandler);
        }, { once: true });
        
        audioElement.src = currentAudioURL;
        markBlobURLAccessed(currentAudioURL);
        
        // Set up download
        downloadBtn.onclick = () => downloadAudio(audioFormat);
        
        // Show success state
        setProgressSuccess();
        resultSection.style.display = 'block';
        progressText.textContent = 'Conversion complete!';
        progressFill.style.width = '100%';
        
        logOutput.textContent += 'Audio extraction completed!\n';
        
        // Clean up FFmpeg file system
        try {
            ffmpeg.FS('unlink', inputFileName);
            ffmpeg.FS('unlink', outputFileName);
        } catch (cleanupError) {
            console.warn('Error cleaning up temporary files:', cleanupError);
        }
        
    } catch (error) {
        console.error('Conversion failed:', error);
        
        // Set error state
        setProgressError();
        progressText.textContent = 'Conversion failed!';
        
        // Detailed error information
        let errorMessage = 'Conversion failed: ';
        if (error.message.includes('ffmpeg')) {
            errorMessage += 'FFmpeg execution error';
        } else if (error.message.includes('file')) {
            errorMessage += 'File processing error';
        } else if (error.message.includes('format')) {
            errorMessage += 'Format not supported';
        } else {
            errorMessage += 'Unknown error';
        }
        
        logOutput.textContent += `❌ ${errorMessage}: ${error.message}\n`;
        logOutput.textContent += 'Please check if the video file format is supported, or try selecting another file.\n';
        
        // Show user-friendly error message
        alert(`${errorMessage}\n\nDetails: ${error.message}\n\nSuggestions:\n1. Check if the video file is complete\n2. Try other video formats\n3. Check network connection`);
        
        // Clean up possible temporary files
        try {
            const inputFileName = 'input.' + getFileExtension(currentVideoFile.name);
            const audioFormat = document.getElementById('audioFormat').value;
            const outputFileName = `output.${audioFormat}`;
            
            ffmpeg.FS('unlink', inputFileName);
            ffmpeg.FS('unlink', outputFileName);
        } catch (cleanupError) {
            console.warn('Error cleaning up temporary files:', cleanupError);
        }
        
    } finally {
        // Restore convert button
        convertBtn.disabled = false;
        convertBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-music button-icon"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M9 17v-13h10v13" /><path d="M9 8h10" /></svg>Start Audio Extraction';
    }
}

// Download audio file with enhanced error handling
function downloadAudio(format) {
    if (!extractedAudioBlob) {
        alert('No audio file available for download');
        return;
    }
    
    const originalName = currentVideoFile.name;
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    const downloadName = `${nameWithoutExt}_extracted.${format}`;
    
    try {
        // Try modern approach first (if supported)
        if (window.showSaveFilePicker) {
            downloadWithFilePicker(extractedAudioBlob, downloadName);
            return;
        }
        
        // Fallback to blob URL approach with retry
        let downloadURL = null;
        let retryCount = 0;
        const maxRetries = 3;
        
        const attemptDownload = () => {
            try {
                // Clean up previous attempt
                if (downloadURL) {
                    revokeSafeBlobURL(downloadURL);
                }
                
                downloadURL = createSafeBlobURL(extractedAudioBlob, `download-attempt-${retryCount}`);
                if (!downloadURL) {
                    throw new Error('Failed to create download URL');
                }
                
                const downloadLink = document.createElement('a');
                downloadLink.href = downloadURL;
                downloadLink.download = downloadName;
                downloadLink.style.display = 'none';
                
                // Add to DOM, click, and remove
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                // Clean up URL after a delay
                setTimeout(() => {
                    revokeSafeBlobURL(downloadURL);
                }, 1000);
                
                console.log('Download initiated successfully');
                
            } catch (error) {
                console.error(`Download attempt ${retryCount + 1} failed:`, error);
                retryCount++;
                
                if (retryCount < maxRetries) {
                    console.log(`Retrying download in 500ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    setTimeout(attemptDownload, 500);
                } else {
                    alert('Download failed after multiple attempts. Please try again.');
                }
            }
        };
        
        attemptDownload();
        
    } catch (error) {
        console.error('Download error:', error);
        alert('Download failed. Please try again.');
    }
}

// Modern file download using File System Access API (if available)
async function downloadWithFilePicker(blob, suggestedName) {
    try {
        const fileHandle = await window.showSaveFilePicker({
            suggestedName: suggestedName,
            types: [{
                description: 'Audio files',
                accept: {
                    'audio/*': ['.mp3', '.wav', '.aac']
                }
            }]
        });
        
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        
        console.log('File saved successfully using File System Access API');
    } catch (error) {
        console.error('File picker download failed:', error);
        throw error;
    }
}



// Reset application
function resetApp() {
    // Clean up blob URLs
    if (currentVideoURL) {
        revokeSafeBlobURL(currentVideoURL);
        currentVideoURL = null;
    }
    if (currentAudioURL) {
        revokeSafeBlobURL(currentAudioURL);
        currentAudioURL = null;
    }
    
    // Reset file input
    videoInput.value = '';
    currentVideoFile = null;
    extractedAudioBlob = null;

    
    // Hide all sections
    videoPreview.style.display = 'none';
    conversionSection.style.display = 'none';
    progressSection.style.display = 'none';
    resultSection.style.display = 'none';
    
    // Reset progress state
    resetProgressState();
    
    // Clear log
    logOutput.textContent = '';
    
    // Reset video preview with proper cleanup
    videoElement.pause();
    videoElement.src = '';
    videoElement.load();
    
    // Reset audio element with proper cleanup
    audioElement.pause();
    audioElement.src = '';
    audioElement.load();
    
    // Reset download link
    downloadBtn.href = '';
    downloadBtn.download = '';
    downloadBtn.onclick = null;
    


}

// Create a safe blob URL with tracking and validation
function createSafeBlobURL(blob, identifier = 'unknown') {
    try {
        if (!blob || !(blob instanceof Blob)) {
            console.error('Invalid blob object provided');
            return null;
        }
        
        // Validate blob size
        if (blob.size === 0) {
            console.warn('Empty blob detected, this may cause issues');
        }
        
        // Check if we already have too many blob URLs
        if (blobURLRegistry.size > 50) {
            console.warn('Too many blob URLs, cleaning up old ones...');
            cleanupOldBlobURLs();
        }
        
        const url = URL.createObjectURL(blob);
        const urlInfo = {
            identifier: identifier,
            created: Date.now(),
            blob: blob,
            size: blob.size,
            accessed: Date.now(),
            accessCount: 0
        };
        
        blobURLRegistry.set(url, urlInfo);
        console.log(`Created blob URL: ${url} (${identifier}, ${formatFileSize(blob.size)})`);
        
        return url;
    } catch (error) {
        console.error('Error creating blob URL:', error);
        return null;
    }
}

// Mark blob URL as accessed (for tracking usage)
function markBlobURLAccessed(url) {
    const urlInfo = blobURLRegistry.get(url);
    if (urlInfo) {
        urlInfo.accessed = Date.now();
        urlInfo.accessCount++;
    }
}

// Safe blob URL cleanup with registry management
function revokeSafeBlobURL(url) {
    if (url && typeof url === 'string') {
        try {
            // Remove from registry first
            const urlInfo = blobURLRegistry.get(url);
            if (urlInfo) {
                console.log(`Revoking blob URL: ${url} (${urlInfo.identifier})`);
                blobURLRegistry.delete(url);
            }
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to revoke blob URL:', error);
        }
    }
}

// Clean up all registered blob URLs
function cleanupAllBlobURLs() {
    console.log(`Cleaning up ${blobURLRegistry.size} blob URLs`);
    for (const [url, urlInfo] of blobURLRegistry) {
        try {
            console.log(`Cleaning up: ${url} (${urlInfo.identifier})`);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error cleaning up blob URL:', url, error);
        }
    }
    blobURLRegistry.clear();
    
    // Force garbage collection if available
    if (window.gc) {
        window.gc();
    }
}

// Clean up old blob URLs with smart strategy
function cleanupOldBlobURLs() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const maxIdleTime = 2 * 60 * 1000; // 2 minutes since last access
    
    const urlsToCleanup = [];
    
    for (const [url, urlInfo] of blobURLRegistry) {
        const age = now - urlInfo.created;
        const idleTime = now - urlInfo.accessed;
        
        // Clean up if:
        // 1. URL is older than 5 minutes, OR
        // 2. URL hasn't been accessed for 2 minutes and has been accessed at least once, OR
        // 3. URL was never accessed and is older than 1 minute
        if (age > maxAge || 
            (idleTime > maxIdleTime && urlInfo.accessCount > 0) ||
            (urlInfo.accessCount === 0 && age > 60000)) {
            urlsToCleanup.push(url);
        }
    }
    
    // Clean up identified URLs
    urlsToCleanup.forEach(url => {
        const urlInfo = blobURLRegistry.get(url);
        console.log(`Cleaning up blob URL: ${url} (${urlInfo.identifier}, age: ${Math.round((now - urlInfo.created) / 1000)}s, accesses: ${urlInfo.accessCount})`);
        revokeSafeBlobURL(url);
    });
    
    if (urlsToCleanup.length > 0) {
        console.log(`Cleaned up ${urlsToCleanup.length} blob URLs`);
    }
}

// Periodically clean up old blob URLs
setInterval(cleanupOldBlobURLs, 60000); // Every minute







// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function getAudioCodec(format) {
    const codecs = {
        'mp3': 'libmp3lame',
        'wav': 'pcm_s16le',
        'aac': 'aac'
    };
    return codecs[format] || 'libmp3lame';
}

function getAudioMimeType(format) {
    const mimeTypes = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'aac': 'audio/aac'
    };
    return mimeTypes[format] || 'audio/mpeg';
}

// Clear previous operation states when selecting new file
function clearPreviousStates() {
    // Clean up previous audio URL if exists
    if (currentAudioURL) {
        revokeSafeBlobURL(currentAudioURL);
        currentAudioURL = null;
    }
    
    // Reset extracted audio blob
    extractedAudioBlob = null;
    
    // Reset audio element
    audioElement.pause();
    audioElement.src = '';
    audioElement.load();
    
    // Reset progress state
    resetProgressState();
    
    // Clear log output
    logOutput.textContent = '';
    
    // Hide progress and result sections
    progressSection.style.display = 'none';
    resultSection.style.display = 'none';
    
    // Reset convert button
    convertBtn.disabled = false;
    convertBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-music button-icon"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M9 17v-13h10v13" /><path d="M9 8h10" /></svg>Start Audio Extraction';
    
    // Reset download button
    downloadBtn.onclick = null;
    
    // Save current user selections before reset
    const currentFormat = document.getElementById('audioFormat').value;
    
    // Reset conversion section form elements to default values
    document.getElementById('audioFormat').value = 'mp3';
    
    // Restore user's previous selections if they were different from default
    if (currentFormat !== 'mp3') {
        document.getElementById('audioFormat').value = currentFormat;
    }
}

// Progress state management
function resetProgressState() {
    progressFill.style.width = '0%';
    progressText.textContent = 'Preparing...';
    
    // Reset progress bar color
    progressFill.style.backgroundColor = '#007bff';
}

function setProgressError() {
    progressFill.style.backgroundColor = '#dc3545';
    progressFill.style.width = '100%';
}

function setProgressSuccess() {
    progressFill.style.backgroundColor = '#28a745';
    progressFill.style.width = '100%';
}

// Update time slider visuals
function updateTimeSliderVisuals(startTime, endTime, startPercentage, endPercentage) {
    const timeSliderStart = document.getElementById('timeSliderStart');
    const timeSliderEnd = document.getElementById('timeSliderEnd');
    const startTooltip = document.querySelector('.start-tooltip');
    const endTooltip = document.querySelector('.end-tooltip');
    
    // Update time labels content AND positions
    if (timeSliderStart) {
        timeSliderStart.textContent = formatTime(startTime);
        timeSliderStart.style.left = startPercentage + '%';
        timeSliderStart.style.transform = 'translateX(-50%)';
    }
    if (timeSliderEnd) {
        timeSliderEnd.textContent = formatTime(endTime);
        timeSliderEnd.style.left = endPercentage + '%';
        timeSliderEnd.style.transform = 'translateX(-50%)';
    }

    // Update tooltips content (position is handled by CSS relative to parent handle)
    if (startTooltip) {
        startTooltip.textContent = formatTime(startTime);
    }
    if (endTooltip) {
        endTooltip.textContent = formatTime(endTime);
    }
    
    console.log(`Updated slider visuals - Start: ${startPercentage}%, End: ${endPercentage}%`);
}

// Create timeline ticks and time delimiters
function createTimelineTicks(duration) {
    const bigIntervals = document.getElementById('bigIntervals');
    const smallIntervals = document.getElementById('smallIntervals');
    const timeDelimiters = document.getElementById('timeDelimiters');
    
    if (!bigIntervals || !smallIntervals || !timeDelimiters || !duration) {
        console.error('Timeline elements not found or duration invalid');
        return;
    }
    
    // Clear existing content
    timeDelimiters.innerHTML = '';
    
    // Calculate appropriate interval based on duration
    let majorInterval, minorInterval;
    if (duration <= 60) { // <= 1 minute
        majorInterval = 10; // 10 seconds
        minorInterval = 2;  // 2 seconds
    } else if (duration <= 300) { // <= 5 minutes
        majorInterval = 30; // 30 seconds
        minorInterval = 10; // 10 seconds
    } else if (duration <= 1800) { // <= 30 minutes
        majorInterval = 120; // 2 minutes
        minorInterval = 30;  // 30 seconds
    } else { // > 30 minutes
        majorInterval = 300; // 5 minutes
        minorInterval = 60;  // 1 minute
    }
    
    // Set background patterns for intervals
    const majorIntervalPercent = (majorInterval / duration) * 100;
    const minorIntervalPercent = (minorInterval / duration) * 100;
    
    bigIntervals.style.backgroundSize = `${majorIntervalPercent}% 100%`;
    smallIntervals.style.backgroundSize = `${minorIntervalPercent}% 100%`;
    
    // Create time delimiter labels
    for (let time = 0; time <= duration; time += majorInterval) {
        const percentage = (time / duration) * 100;
        const delimiter = document.createElement('div');
        delimiter.className = 'time-delimiter';
        delimiter.style.left = percentage + '%';
        delimiter.textContent = formatTime(time);
        timeDelimiters.appendChild(delimiter);
    }
    
    console.log(`Created timeline ticks for ${formatTime(duration)} duration`);
}

// Initialize time slider functionality
function initializeTimeSlider(duration) {
    const timeSliderTrack = document.getElementById('timeSliderTrack');
    const startHandle = document.getElementById('startHandle');
    const endHandle = document.getElementById('endHandle');
    const timeSliderRange = document.getElementById('timeSliderRange');
    const progressIndicator = document.getElementById('progressIndicator');
    
    if (!timeSliderTrack || !startHandle || !endHandle || !timeSliderRange) {
        console.error('Time slider elements not found');
        return;
    }
    
    let isDragging = false;
    let currentHandle = null;
    let startTime = 0;
    let endTime = duration;
    
    // Update slider range visual
    function updateSliderRange() {
        const startPercent = (startTime / duration) * 100;
        const endPercent = (endTime / duration) * 100;
        const rangeWidth = endPercent - startPercent;
        
        timeSliderRange.style.left = startPercent + '%';
        timeSliderRange.style.width = rangeWidth + '%';
        
        startHandle.style.left = startPercent + '%';
        endHandle.style.left = endPercent + '%';
        
        // Update time labels
        updateTimeSliderVisuals(startTime, endTime, startPercent, endPercent);
        
        // Update time inputs
        const startTimeInput = document.getElementById('startTime');
        const endTimeInput = document.getElementById('endTime');
        if (startTimeInput) startTimeInput.value = formatTimeForInput(startTime);
        if (endTimeInput) endTimeInput.value = formatTimeForInput(endTime);
    }
    
    // Handle mouse down on handles
    function handleMouseDown(e, handle) {
        e.preventDefault();
        isDragging = true;
        currentHandle = handle;
        
        handle.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
        
        // Pause video when starting to drag any handle
        if (videoElement && !videoElement.paused) {
            videoElement.pause();
        }
        
        console.log(`Started dragging ${handle.dataset.handle} handle`);
    }
    
    // Handle mouse move
    function handleMouseMove(e) {
        if (!isDragging || !currentHandle) return;
        
        const rect = timeSliderTrack.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
        const time = (percentage / 100) * duration;
        
        if (currentHandle.dataset.handle === 'start') {
            startTime = Math.min(time, endTime - 1); // Ensure start < end
            // Update video current time and progress indicator when dragging start handle
            if (videoElement && videoElement.duration > 0) {
                videoElement.currentTime = startTime;
                updateProgressIndicator(startTime, videoElement.duration);
            }
        } else {
            endTime = Math.max(time, startTime + 1); // Ensure end > start
        }
        
        updateSliderRange();
    }
    
    // Handle mouse up
    function handleMouseUp() {
        if (isDragging && currentHandle) {
            currentHandle.classList.remove('dragging');
            console.log(`Stopped dragging ${currentHandle.dataset.handle} handle`);
        }
        
        isDragging = false;
        currentHandle = null;
        document.body.style.cursor = '';
    }
    
    // Add event listeners
    startHandle.addEventListener('mousedown', (e) => handleMouseDown(e, startHandle));
    endHandle.addEventListener('mousedown', (e) => handleMouseDown(e, endHandle));
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Handle track clicks
    timeSliderTrack.addEventListener('click', (e) => {
        if (isDragging) return;
        
        const rect = timeSliderTrack.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = (x / rect.width) * 100;
        const clickTime = (percentage / 100) * duration;
        
        // Move the closest handle
        const distToStart = Math.abs(clickTime - startTime);
        const distToEnd = Math.abs(clickTime - endTime);
        
        if (distToStart < distToEnd) {
            startTime = Math.min(clickTime, endTime - 1);
            // Update video current time and progress indicator when clicking near start
            if (videoElement && videoElement.duration > 0) {
                videoElement.currentTime = startTime;
                updateProgressIndicator(startTime, videoElement.duration);
            }
        } else {
            endTime = Math.max(clickTime, startTime + 1);
        }
        
        updateSliderRange();
        
        // Seek video to clicked time (removed the paused check to always seek)
        if (videoElement && videoElement.duration > 0) {
            videoElement.currentTime = clickTime;
            updateProgressIndicator(clickTime, videoElement.duration);
        }
    });
    
    // Initialize with full range
    updateSliderRange();
    
    console.log('Time slider initialized successfully');
    
    return {
        getStartTime: () => startTime,
        getEndTime: () => endTime,
        setStartTime: (time) => {
            startTime = Math.max(0, Math.min(time, endTime - 1));
            updateSliderRange();
            // Update video current time and progress indicator when setting start time
            if (videoElement && videoElement.duration > 0) {
                videoElement.currentTime = startTime;
                updateProgressIndicator(startTime, videoElement.duration);
            }
        },
        setEndTime: (time) => {
            endTime = Math.min(duration, Math.max(time, startTime + 1));
            updateSliderRange();
            // Update video current time and progress indicator when setting end time
            if (videoElement && videoElement.duration > 0) {
                videoElement.currentTime = endTime;
                updateProgressIndicator(endTime, videoElement.duration);
            }
        },
        reset: () => {
            startTime = 0;
            endTime = duration;
            updateSliderRange();
            // Update video current time and progress indicator when resetting
            if (videoElement && videoElement.duration > 0) {
                videoElement.currentTime = 0;
                updateProgressIndicator(0, videoElement.duration);
            }
        }
    };
}

// Format time for input fields (HH:MM:SS)
function formatTimeForInput(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Update progress indicator
function updateProgressIndicator(currentTime, duration) {
    const progressIndicator = document.getElementById('progressIndicator');
    if (!progressIndicator || !duration) return;
    
    const percentage = (currentTime / duration) * 100;
    progressIndicator.style.width = percentage + '%';
    progressIndicator.classList.add('visible');
}



// Reset time range to full video
function resetTimeRange() {
    if (!videoElement || !videoElement.timeSlider) {
        console.error('Video element or time slider not available');
        return;
    }
    
    videoElement.timeSlider.reset();
    console.log('Reset time range to full video');
}

// Parse time input (HH:MM:SS) to seconds
function parseTimeInput(timeString) {
    const parts = timeString.split(':').map(part => parseInt(part, 10));
    if (parts.length !== 3) return 0;
    
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

// Initialize time input controls
function initializeTimeInputs() {
    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');
    
    if (!startTimeInput || !endTimeInput) {
        console.error('Time input elements not found');
        return;
    }
    
    // Validate time inputs
    function validateTimeInputs() {
        if (!videoElement || !videoElement.duration) return;
        
        const startTime = parseTimeInput(startTimeInput.value);
        const endTime = parseTimeInput(endTimeInput.value);
        const videoDuration = videoElement.duration;
        
        // Ensure start time is not greater than end time
        if (startTime >= endTime) {
            const newEndTime = Math.min(startTime + 1, videoDuration);
            endTimeInput.value = formatTimeForInput(newEndTime);
            if (videoElement.timeSlider) {
                videoElement.timeSlider.setEndTime(newEndTime);
            }
        }
        
        // Ensure end time doesn't exceed video duration
        if (endTime > videoDuration) {
            endTimeInput.value = formatTimeForInput(videoDuration);
            if (videoElement.timeSlider) {
                videoElement.timeSlider.setEndTime(videoDuration);
            }
        }
        
        // Ensure start time is not negative
        if (startTime < 0) {
            startTimeInput.value = formatTimeForInput(0);
            if (videoElement.timeSlider) {
                videoElement.timeSlider.setStartTime(0);
            }
        }
    }
    
    // Handle start time input change
    startTimeInput.addEventListener('change', () => {
        if (!videoElement || !videoElement.timeSlider) return;
        
        const startTime = parseTimeInput(startTimeInput.value);
        const endTime = parseTimeInput(endTimeInput.value);
        
        // Validate and adjust if necessary
        if (startTime >= endTime) {
            const newEndTime = Math.min(startTime + 1, videoElement.duration);
            endTimeInput.value = formatTimeForInput(newEndTime);
            videoElement.timeSlider.setEndTime(newEndTime);
        }
        
        videoElement.timeSlider.setStartTime(startTime);
        console.log(`Start time set via input: ${formatTime(startTime)}`);
    });
    
    // Handle end time input change
    endTimeInput.addEventListener('change', () => {
        if (!videoElement || !videoElement.timeSlider) return;
        
        const endTime = parseTimeInput(endTimeInput.value);
        const startTime = parseTimeInput(startTimeInput.value);
        const videoDuration = videoElement.duration;
        
        // Validate and adjust if necessary
        let validEndTime = endTime;
        
        // Ensure end time doesn't exceed video duration
        if (endTime > videoDuration) {
            validEndTime = videoDuration;
            endTimeInput.value = formatTimeForInput(videoDuration);
        }
        
        // Ensure end time is greater than start time
        if (validEndTime <= startTime) {
            validEndTime = Math.min(startTime + 1, videoDuration);
            endTimeInput.value = formatTimeForInput(validEndTime);
        }
        
        videoElement.timeSlider.setEndTime(validEndTime);
        console.log(`End time set via input: ${formatTime(validEndTime)}`);
    });
    
    console.log('Time input controls initialized');
}

// Initialize after page load
let isDOMReady = false;
let isFFmpegScriptLoaded = false;



// Also clean up on page visibility change (when tab becomes hidden)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Clean up any ongoing operations when tab becomes hidden
        console.log('Tab hidden, cleaning up resources');
    }
});

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, starting initialization...');
    startInitTimer();
    initApp();
    initializeTimeInputs();
    initializePlayButton();
});

// Initialize play button functionality
function initializePlayButton() {
    const playButton = document.getElementById('playButton');
    const playIcon = playButton.querySelector('.play-icon');
    const pauseIcon = playButton.querySelector('.pause-icon');
    
    if (!playButton || !playIcon || !pauseIcon) {
        console.error('Play button elements not found');
        return;
    }
    
    // Handle play button click
    playButton.addEventListener('click', () => {
        if (!videoElement || !videoElement.src) {
            console.warn('No video loaded');
            return;
        }
        
        if (videoElement.paused) {
            videoElement.play().then(() => {
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
                console.log('Video started playing');
            }).catch(error => {
                console.error('Error playing video:', error);
            });
        } else {
            videoElement.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            console.log('Video paused');
        }
    });
    
    // Listen for video events to update button state
    if (videoElement) {
        videoElement.addEventListener('play', () => {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        });
        
        videoElement.addEventListener('pause', () => {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        });
        
        videoElement.addEventListener('ended', () => {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        });
        
        // Update progress indicator during playback
        videoElement.addEventListener('timeupdate', () => {
            if (videoElement.duration > 0) {
                updateProgressIndicator(videoElement.currentTime, videoElement.duration);
            }
        });
    }
    
    console.log('Play button initialized successfully');
}

// Make functions globally available for HTML onclick handlers
window.resetTimeRange = resetTimeRange;