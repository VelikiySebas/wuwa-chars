// upload_roles.js
import fs from 'fs/promises';
import axios from 'axios';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';

dotenv.config();

const {
  GITHUB_TOKEN,
  GITHUB_USER,
  REPO_NAME,
  BRANCH = 'main',
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_USER || !REPO_NAME) {
  console.error('❗ Не забыть указать GITHUB_TOKEN, GITHUB_USER и REPO_NAME в .env');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Скачивает изображение и возвращает буфер (или null)
async function downloadImage(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    return resp.data;
  } catch (err) {
    console.error(`✖ Ошибка скачивания ${url}: ${err.message}`);
    return null;
  }
}

// Заливка файла в GitHub, возвращает true/false
async function uploadToGitHub(filePath, buffer, message) {
  if (!buffer) return false;
  const base64 = buffer.toString('base64');
  let sha;

  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_USER,
      repo: REPO_NAME,
      path: filePath,
      ref: BRANCH,
    });
    sha = data.sha;
  } catch {
    // файла нет — загрузим как новый
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: REPO_NAME,
      path: filePath,
      message,
      content: base64,
      branch: BRANCH,
      sha,
    });
    return true;
  } catch (err) {
    console.error(`✖ Ошибка загрузки ${filePath}: ${err.message}`);
    return false;
  }
}

async function main() {
  // 0) Получаем список ролей
  let roles;
  try {
    const resp = await axios.get('https://api.encore.moe/en/character/');
    roles = resp.data.roleList;
  } catch (err) {
    console.error('✖ Не удалось получить список ролей:', err.message);
    return;
  }

  const result = [];

  for (const role of roles) {
    const { Id: id, Name: name, QualityId: rarity, Element, WeaponType: weaponType } = role;
    console.log(`\n→ Обработка роли ${id} — ${name}`);

    // 1) скачиваем RoleHeadIcon
    const headBuf = await downloadImage(role.RoleHeadIcon);
    const headPath = `icons/${id}.png`;
    const okHead = await uploadToGitHub(headPath, headBuf, `chore: upload head ${id}`);
    if (!okHead) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки аватарки`);
      continue;
    }

    // 2) формируем новый URL для портрета
    let pileUrl;
    try {
      // detail.FormationRoleCard может быть абсолютным или относительным URL
      const detail = await axios.get(`https://api.encore.moe/en/character/${id}`);
      let original = detail.data.FormationRoleCard;
      // Если относительный, сделаем его абсолютным для разбора
      if (!original.startsWith('http')) {
        original = 'https://api-v2.encore.moe/resource/Data/Game/Aki' + original;
      }
      const parsed = new URL(original);
      // Найдём часть пути от "/UI"
      const uiIndex = parsed.pathname.indexOf('/UI');
      if (uiIndex !== -1) {
        const sub = parsed.pathname.slice(uiIndex); 
        // Собираем новый URL и заменяем .png на .webp
        pileUrl = `https://api.hakush.in/ww${sub.replace(/\.png$/, '.webp')}`;
      } else {
        throw new Error('не найдена часть /UI в пути ' + parsed.pathname);
      }
    } catch (err) {
      console.error(`✖ Не удалось вычислить URL портрета для ${id}: ${err.message}`);
      continue;
    }

    // 3) скачиваем портрет из нового API
    const portBuf = await downloadImage(pileUrl);
    const portPath = `portraits/${id}.webp`;
    const okPort = await uploadToGitHub(portPath, portBuf, `chore: upload portrait ${id}`);
    if (!okPort) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки портрета`);
      continue;
    }

    // 4) добавляем в итог
    result.push({
      id,
      name,
      rarity,
      element: Element.Id,
      weaponType,
      RoleHead: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${headPath}`,
      RolePortrait: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${portPath}`,
    });

    console.log(`✔ Роль ${id} добавлена в JSON`);
  }

  // 5) сохраняем result в roles.json
  try {
    await fs.writeFile('roles.json', JSON.stringify(result, null, 2), 'utf8');
    console.log('\n✅ Успех! roles.json сохранён');
  } catch (err) {
    console.error('✖ Ошибка записи roles.json:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
