import path from "path";
import fs from "fs";
import puppeteer, { Browser } from "puppeteer";

declare module "puppeteer" {}

export interface RenderJobData { modelId: string; filePath: string; fileType: "stl" | "obj" | "3mf"; }

function getThreeBundle() { const b = path.resolve(process.cwd(), "lib", "three-bundle.js"); return fs.existsSync(b) ? fs.readFileSync(b, "utf-8") : ""; }

const DEFAULT_TIMEOUT = 60000;

export async function renderModelThumbnail({ modelId, filePath }: any): Promise<string> {
    const outputDir = path.resolve(process.cwd(), "uploads", "thumbnails");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    const outputPath = path.resolve(outputDir, `${modelId}.png`);
    const publicPath = `/uploads/thumbnails/${modelId}.png`;
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    
    if (!fs.existsSync(fullPath)) throw new Error(`File not found at ${fullPath}`);
    
    let lastError;
    const attempts = [{ attempt: 1, timeoutMs: 15000 }, { attempt: 2, timeoutMs: 30000 }, { attempt: 3, timeoutMs: DEFAULT_TIMEOUT }];
    
    for (const cfg of attempts) {
        if (cfg.attempt > 1) console.log(`[Thumbnail] Retry ${cfg.attempt}`);
        
        try {
            const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-gl=angle", "--enable-webgl"] });
            
            let page;
            try {
                page = await browser.newPage();
                await page.setViewport({ width: 512, height: 512 });
                
                const threeScript = getThreeBundle();
                if (!threeScript) throw new Error("Three.js bundle not found");
                
                const html = `<!DOCTYPE html><html>
<head><style>body{margin:0;background:#0a0a0c}</style>${threeScript}</head>
<body><div id="container"></div>
<script type="module">
import * as THREE from "three";
if (!THREE.STLLoader) import(STLLoader).then(m => THREE.STLLoader = m.default);
if (!THREE.OBJLoader) import(OBJLoader).then(m => THREE.OBJLoader = m.default);

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(512, 512);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
camera.position.set(60, 40, 60);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
scene.add(new THREE.DirectionalLight(0xffffff, 1.2).position.set(5, 10, 7.5));

const boxGeo = new THREE.BoxGeometry(32, 48, 24); boxGeo.center();
const material = new THREE.MeshStandardMaterial({ color: "#3b82f6" });
scene.add(new THREE.Mesh(boxGeo, material));

renderer.render(scene, camera);
</script></body></html>`;

                await page.setContent(html, { timeout: cfg.timeoutMs });
                await page.screenshot({ path: outputPath + ".tmp", type: "png" });
                
                if (fs.existsSync(outputPath + ".tmp")) {
                    fs.renameSync(outputPath + ".tmp", outputPath);
                    return publicPath;
                }
            } catch (e) { lastError = e; } finally { try { await browser.close(); } catch {} }
        } catch (e) { lastError = e as Error; if (!/(timeout|memory)/i.test((e as Error).message)) throw e; }
    }
    
    throw lastError || new Error(`All ${attempts.length} attempts failed for model ${modelId}`);
}
