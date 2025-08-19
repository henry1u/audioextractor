// Web Worker for FFmpeg operations to prevent main thread blocking
// This worker handles all FFmpeg operations in a separate thread

let ffmpeg = null;
let isFFmpegLoaded = false;

// FFmpeg will be loaded in main thread and passed to worker
let ffmpegLoaded = false;
let FFmpegWASM = null;



// Initialize FFmpeg in worker
async function initFFmpegWorker(initData) {
    try {
        // Send initial status
        self.postMessage({ type: 'log', message: 'Starting FFmpeg initialization...' });
        
        // Check if FFmpeg is available from main thread
        if (initData && !initData.ffmpegAvailable) {
            throw new Error('FFmpeg not available');
        }
        
        // Check which API version is available
        if (self.FFmpegWASM && self.FFmpegWASM.FFmpeg) {
            // New API (0.12.x)
            const { FFmpeg } = self.FFmpegWASM;
            ffmpeg = new FFmpeg();
            
            // Set up logging
            ffmpeg.on('log', ({ message }) => {
                self.postMessage({ type: 'log', message });
            });
            
            // Set up progress reporting
            ffmpeg.on('progress', ({ progress }) => {
                self.postMessage({ type: 'progress', ratio: progress });
            });
        } else if (self.createFFmpeg) {
            // Old API (0.10.x - 0.11.x) or Local Fallback
            {
                // Real FFmpeg from CDN
                self.postMessage({ type: 'log', message: 'Loading FFmpeg from CDN...' });
                const coreVersion = '0.10.0';
                ffmpeg = self.createFFmpeg({
                    log: true,
                    corePath: `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist/ffmpeg-core.js`
                });
                
                // Set up logging for old API
                ffmpeg.setLogger(({ message }) => {
                    self.postMessage({ type: 'log', message });
                });
                
                // Set up progress reporting for old API
                ffmpeg.setProgress(({ ratio }) => {
                    self.postMessage({ type: 'progress', ratio });
                });
            }
        } else {
            // FFmpeg library not found
            throw new Error('FFmpeg library not found');
        }
        
        // Load FFmpeg
        self.postMessage({ type: 'log', message: 'Loading FFmpeg core...' });
        await ffmpeg.load();
        self.postMessage({ type: 'log', message: 'FFmpeg core loaded successfully' });
        isFFmpegLoaded = true;
        
        self.postMessage({
            type: 'ffmpeg-loaded',
            success: true
        });
        
    } catch (error) {
        self.postMessage({
            type: 'ffmpeg-loaded',
            success: false,
            error: error.message
        });
    }
}

// Handle messages from main thread
self.onmessage = async function(e) {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'init':
                await initFFmpegWorker(data);
                break;
                
            case 'convert':
                await handleConversion(data);
                break;
                
            case 'get-bitrate':
                await getBitrate(data);
                break;
                
            case 'cleanup':
                await cleanup(data);
                break;
                
            default:
                self.postMessage({
                    type: 'error',
                    error: `Unknown message type: ${type}`
                });
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
};

// Handle video conversion
async function handleConversion(data) {
    if (!isFFmpegLoaded) {
        throw new Error('FFmpeg not loaded');
    }
    
    const {
        fileData,
        fileName,
        audioFormat,
        audioBitrate,
        startSeconds,
        endSeconds,
        isFullVideo,
        useWorkerFS
    } = data;
    
    try {
        const inputFileName = `input_${Date.now()}.${fileName.split('.').pop()}`;
        const outputFileName = `output.${audioFormat}`;
        
        postMessage({
            type: 'log',
            message: 'Loading file into worker memory...'
        });
        
        // Write file to worker filesystem
        if (self.createFFmpeg) {
            // Old API (0.11.x)
            if (fileData instanceof File) {
                const arrayBuffer = await fileData.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                ffmpeg.FS('writeFile', inputFileName, uint8Array);
            } else {
                ffmpeg.FS('writeFile', inputFileName, fileData);
            }
        } else {
            // New API (0.12.x)
            if (fileData instanceof File) {
                const arrayBuffer = await fileData.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                await ffmpeg.writeFile(inputFileName, uint8Array);
            } else {
                await ffmpeg.writeFile(inputFileName, fileData);
            }
        }
        
        postMessage({
            type: 'log',
            message: 'File loaded successfully, starting conversion...'
        });
        
        // Build FFmpeg command
        let command = ['-i', inputFileName];
        
        // Add time range parameters if not processing full video
        if (!isFullVideo) {
            command.push('-ss', startSeconds.toString());
            command.push('-t', (endSeconds - startSeconds).toString());
        }
        
        // Continue building command
        command.push('-vn'); // No video
        
        // Add codec and bitrate parameters based on format
        if (audioFormat === 'mp3') {
            command.push('-acodec', 'libmp3lame', '-ab', audioBitrate);
        } else if (audioFormat === 'aac') {
            command.push('-acodec', 'aac', '-ab', audioBitrate);
        } else if (audioFormat === 'wav') {
            command.push('-acodec', 'pcm_s16le', '-ab', audioBitrate);
        }
        
        command.push('-ar', '44100', '-y', outputFileName);
        
        postMessage({
            type: 'log',
            message: `Executing: ffmpeg ${command.join(' ')}`
        });
        
        // Execute conversion
        let outputData;
        if (self.createFFmpeg) {
            // Old API (0.11.x)
            await ffmpeg.run(...command);
            
            // Read output file
            outputData = ffmpeg.FS('readFile', outputFileName);
            
            // Clean up files
            ffmpeg.FS('unlink', inputFileName);
            ffmpeg.FS('unlink', outputFileName);
        } else {
            // New API (0.12.x)
            await ffmpeg.exec(command);
            
            // Read output file
            outputData = await ffmpeg.readFile(outputFileName);
            
            // Clean up files
            await ffmpeg.deleteFile(inputFileName);
            await ffmpeg.deleteFile(outputFileName);
        }
        
        // Send result back to main thread
        postMessage({
            type: 'conversion-complete',
            outputData: outputData.buffer, // Transfer ArrayBuffer
            audioFormat: audioFormat
        }, [outputData.buffer]); // Transfer ownership
        
    } catch (error) {
        postMessage({
            type: 'conversion-error',
            error: error.message
        });
    }
}

// Get audio bitrate from file
async function getBitrate(data) {
    if (!isFFmpegLoaded) {
        throw new Error('FFmpeg not loaded');
    }
    
    const { fileData, fileName } = data;
    
    try {
        const inputFileName = `probe_${Date.now()}.${fileName.split('.').pop()}`;
        
        // Write file for probing
        if (self.createFFmpeg) {
            // Old API (0.11.x)
            ffmpeg.FS('writeFile', inputFileName, fileData);
        } else {
            // New API (0.12.x)
            await ffmpeg.writeFile(inputFileName, fileData);
        }
        
        // Get bitrate
        if (self.createFFmpeg) {
            // Old API (0.11.x)
            await ffmpeg.run(
                '-i', inputFileName,
                '-v', 'quiet',
                '-show_entries', 'stream=bit_rate',
                '-select_streams', 'a:0',
                '-of', 'csv=p=0'
            );
            ffmpeg.FS('unlink', inputFileName);
        } else {
            // New API (0.12.x)
            await ffmpeg.exec([
                '-i', inputFileName,
                '-v', 'quiet',
                '-show_entries', 'stream=bit_rate',
                '-select_streams', 'a:0',
                '-of', 'csv=p=0'
            ]);
            await ffmpeg.deleteFile(inputFileName);
        }
        
        postMessage({
            type: 'bitrate-complete'
        });
        
    } catch (error) {
        postMessage({
            type: 'bitrate-error',
            error: error.message
        });
    }
}

// Cleanup worker resources
async function cleanup(data) {
    try {
        if (ffmpeg && isFFmpegLoaded) {
            // Terminate FFmpeg instance to free memory
            if (self.createFFmpeg) {
                // Old API (0.11.x) - exit method
                ffmpeg.exit();
            } else {
                // New API (0.12.x) - terminate method
                await ffmpeg.terminate();
            }
            isFFmpegLoaded = false;
            ffmpeg = null;
        }
        
        postMessage({
            type: 'cleanup-complete'
        });
        
    } catch (error) {
        postMessage({
            type: 'cleanup-error',
            error: error.message
        });
    }
}