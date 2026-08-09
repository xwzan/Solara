/**
 * 下载到NAS路由
 * POST /api/download
 * Body: { song: { id, source, name, artist }, quality: "320" }
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const NAS_DOWNLOAD_DIR = process.env.NAS_DOWNLOAD_DIR || '/app/downloads';
const API_BASE_URL = process.env.API_BASE_URL || 'https://music-api.gdstudio.xyz/api.php';

// 确保下载目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 从API获取歌曲真实URL
async function fetchSongUrl(songId, source, quality) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set('types', 'url');
  url.searchParams.set('id', songId);
  url.searchParams.set('source', source);
  url.searchParams.set('br', quality);

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const data = await res.json();
  return data;
}

// 安全文件名
function sanitizeFilename(name) {
  if (!name) return 'unknown';
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

module.exports = function createDownloadRouter() {
  const router = Router();

  router.post('/', async (req, res) => {
    const { song, quality = '320' } = req.body;
    if (!song || !song.id || !song.source) {
      return res.status(400).json({ error: 'Missing song info' });
    }

    try {
      ensureDir(NAS_DOWNLOAD_DIR);

      // 获取真实下载URL
      const audioData = await fetchSongUrl(song.id, song.source, quality);
      if (!audioData || !audioData.url) {
        return res.status(502).json({ error: '无法获取音频地址' });
      }

      // 确定扩展名
      let ext = 'mp3';
      if (quality === '999') ext = 'flac';
      else if (quality === '740') ext = 'ape';
      try {
        const urlPath = new URL(audioData.url).pathname;
        const match = urlPath.match(/\.([a-z0-9]+)$/i);
        if (match) ext = match[1];
      } catch (e) {}

      const artist = Array.isArray(song.artist) ? song.artist.join(', ') : (song.artist || '未知艺术家');
      const filename = `${sanitizeFilename(song.name)} - ${sanitizeFilename(artist)}.${ext}`;
      const filepath = path.join(NAS_DOWNLOAD_DIR, filename);

      // 如果文件已存在，直接返回成功
      if (fs.existsSync(filepath)) {
        return res.json({ success: true, message: '文件已存在', filename });
      }

      // 下载文件
      const response = await fetch(audioData.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        return res.status(502).json({ error: '下载音频失败' });
      }

      const fileStream = fs.createWriteStream(filepath);
      await pipeline(response.body, fileStream);

      res.json({ success: true, message: '下载成功', filename });
    } catch (error) {
      console.error('[Download to NAS]', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
