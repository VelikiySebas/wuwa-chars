// upload_roles_and_weapons.js
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
  console.error('❗ Укажите GITHUB_TOKEN, GITHUB_USER и REPO_NAME в .env');
  process.exit(1);
}

// Список ID ролей, которые нужно пропустить
const skipRoleIds = [1501, 1406, 1605];

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Скачивает изображение, возвращает Buffer или null
async function downloadImage(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    return resp.data;
  } catch (err) {
    console.error(`✖ Ошибка скачивания ${url}: ${err.message}`);
    return null;
  }
}

// Загружает (или обновляет) файл в GitHub, возвращает true/false
async function uploadToGitHub(pathInRepo, buffer, commitMsg) {
  if (!buffer) return false;
  const content = buffer.toString('base64');
  let sha;
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_USER,
      repo: REPO_NAME,
      path: pathInRepo,
      ref: BRANCH,
    });
    sha = data.sha;
  } catch {
    // файл отсутствует — загрузим как новый
  }
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: REPO_NAME,
      path: pathInRepo,
      message: commitMsg,
      content,
      branch: BRANCH,
      sha,
    });
    return true;
  } catch (err) {
    console.error(`✖ Ошибка загрузки ${pathInRepo}: ${err.message}`);
    return false;
  }
}

async function main() {
  // === Часть 1: Роли ===
  let rolesList = [];
  try {
    const resp = await axios.get('https://api.encore.moe/en/character/');
    rolesList = resp.data.roleList;
  } catch (err) {
    console.error('✖ Не удалось получить список ролей:', err.message);
  }

  const rolesResult = [];

  for (const role of rolesList) {
    const { Id: id, Name: name, QualityId: rarity, Element, WeaponType: weaponType } = role;

    if (skipRoleIds.includes(id)) {
      console.log(`→ Пропускаем роль ${id} — ${name}`);
      continue;
    }

    console.log(`\n→ Обработка роли ${id} — ${name}`);

    // Скачиваем и заливаем аватарку
    const headBuf = await downloadImage(role.RoleHeadIcon);
    const headPath = `icons/${id}.png`;
    if (!await uploadToGitHub(headPath, headBuf, `chore: upload head ${id}`)) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки аватарки`);
      continue;
    }

    // Формируем URL портрета и скачиваем
    let pileUrl;
    try {
      const detail = await axios.get(`https://api.encore.moe/en/character/${id}`);
      let orig = detail.data.FormationRoleCard;
      if (!orig.startsWith('http')) {
        orig = 'https://api-v2.encore.moe/resource/Data/Game/Aki' + orig;
      }
      const parsed = new URL(orig);
      const uiIndex = parsed.pathname.indexOf('/UI');
      if (uiIndex < 0) throw new Error('часть /UI не найдена');
      const sub = parsed.pathname.slice(uiIndex);
      pileUrl = `https://api.hakush.in/ww${sub.replace(/\.png$/, '.webp')}`;
    } catch (err) {
      console.error(`✖ Не удалось получить URL портрета для роли ${id}: ${err.message}`);
      continue;
    }

    const portBuf = await downloadImage(pileUrl);
    const portPath = `portraits/${id}.webp`;
    if (!await uploadToGitHub(portPath, portBuf, `chore: upload portrait ${id}`)) {
      console.warn(`⚠ Пропускаем роль ${id} из-за ошибки портрета`);
      continue;
    }

    rolesResult.push({
      id,
      name,
      rarity,
      element: Element.Id,
      weaponType,
      RoleHead:     `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${headPath}`,
      RolePortrait: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${portPath}`,
    });

    console.log(`✔ Роль ${id} успешно добавлена`);
  }

  // === Часть 2: Оружие ===
  let weaponsData = {};
  try {
    const resp = await axios.get('https://api.hakush.in/ww/data/weapon.json');
    weaponsData = resp.data;
  } catch (err) {
    console.error('✖ Не удалось получить данные об оружии:', err.message);
  }

  const weaponsResult = [];

  for (const [idStr, w] of Object.entries(weaponsData)) {
    const idNum = Number(idStr);
    const nameEn = w.en;
    // Пропускаем оружие с "Projection" в названии
    if (nameEn.includes('Projection')) {
      console.log(`→ Пропускаем оружие ${idNum} — ${nameEn} (Projection)`);
      continue;
    }

    console.log(`\n→ Обработка оружия ${idNum} — ${nameEn}`);

    // Парсим поля
    const rank = w.rank;
    const type = w.type;
    const name = w.en;

    // Формируем URL иконки
    // w.icon: "/Game/Aki/UI/UIResources/.../T_IconWeapon<ID>_UI.T_IconWeapon<ID>_UI"
    const rawIcon = w.icon.replace(/^\/Game\/Aki\/UI\//, '');
    const resource = rawIcon.split('.')[0]; // "UIResources/.../T_IconWeapon21050064_UI"
    const iconUrl = `https://api.hakush.in/ww/UI/${resource}.webp`;

    const iconBuf = await downloadImage(iconUrl);
    const iconPath = `weapons/${id}.webp`;
    if (!await uploadToGitHub(iconPath, iconBuf, `chore: upload weapon ${id}`)) {
      console.warn(`⚠ Пропускаем оружие ${id} из-за ошибки иконки`);
      continue;
    }

    weaponsResult.push({
      id,
      rank,
      type,
      name,
      icon: `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/${BRANCH}/${iconPath}`,
    });

    console.log(`✔ Оружие ${id} успешно добавлено`);
  }

  // === Запись итоговых JSON ===
  try {
    await fs.writeFile('roles.json', JSON.stringify(rolesResult,   null, 2), 'utf8');
    console.log('\n✅ roles.json сохранён');
    await fs.writeFile('weapons.json', JSON.stringify(weaponsResult, null, 2), 'utf8');
    console.log('✅ weapons.json сохранён');
  } catch (err) {
    console.error('✖ Ошибка записи JSON-файлов:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
