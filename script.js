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
  console.error('Не забыть указать GITHUB_TOKEN, GITHUB_USER и REPO_NAME в .env');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Скачивает изображение и возвращает буфер
async function downloadImage(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    return resp.data;
  } catch (err) {
    console.error(`✖ Ошибка скачивания изображения ${url}:`, err.message);
    return null;
  }
}

// Заливка файла в GitHub, возвращает true/false
async function uploadToGitHub(filePath, contentBuffer, message) {
  if (!contentBuffer) return false;
  const contentBase64 = contentBuffer.toString('base64');
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
    // Файла нет — загрузим как новый
  }

  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: REPO_NAME,
      path: filePath,
      message,
      content: contentBase64,
      branch: BRANCH,
      sha,
    });
    return true;
  } catch (err) {
    console.error(`✖ Ошибка загрузки ${filePath} в GitHub:`, err.message);
    return false;
  }
}

async function main() {
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
    const { Id: id, Name: name, QualityId: rarity, Element } = role;
    console.log(`\n→ Обрабатываем роль ${id} – ${name}`);

    // 1) Скачиваем RoleHeadIcon
    const headBuf = await downloadImage(role.RoleHeadIcon);
    const headPath = `icons/role_head_${id}.png`;
    const headOk = await uploadToGitHub(
      headPath,
      headBuf,
      `chore: upload role head ${id}`
    );
    if (!headOk) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки с RoleHeadIcon`);
      continue;
    }

    // 2) Получаем портрет
    let portraitUrl, portraitBuf;
    try {
      const detail = await axios.get(`https://api.encore.moe/en/character/${id}`);
      portraitUrl = detail.data.FormationRoleCard;
      portraitBuf = await downloadImage(portraitUrl);
    } catch (err) {
      console.error(`✖ Ошибка получения портрета для ${id}:`, err.message);
      continue;
    }

    const portPath = `portraits/role_portrait_${id}.png`;
    const portOk = await uploadToGitHub(
      portPath,
      portraitBuf,
      `chore: upload role portrait ${id}`
    );
    if (!portOk) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки с портретом`);
      continue;
    }

    // 3) Собираем JSON-объект
    result.push({
      id,
      name,
      rarity,
      element: Element.Id,
      RoleHead: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${headPath}`,
      RolePortrait: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${portPath}`,
    });

    console.log(`✔ Роль ${id} успешно обработана`);
  }

  // 4) Записываем итоговый JSON
  try {
    const json = JSON.stringify(result, null, 2);
    await fs.writeFile('roles.json', json, 'utf8');
    console.log('\n✅ roles.json сохранён');
  } catch (err) {
    console.error('✖ Ошибка записи roles.json:', err.message);
  }
}

main().catch(err => {
  console.error('Непредвиденная ошибка:', err);
});
