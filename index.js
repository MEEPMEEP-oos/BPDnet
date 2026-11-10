const {
    Client, Events, GatewayIntentBits, PermissionFlagsBits,
    ChannelType, OverwriteType, ComponentType, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, SlashCommandBuilder,
    AttachmentBuilder, FileBuilder, ContainerBuilder,
    TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, SeparatorSpacingSize
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    allowedMentions: { parse: [], repliedUser: false }
});

// ============================================================
// CONFIGURATION
// ============================================================

const PREFIX = 'b!';

const CONFIG = {
    VERIFIED_ROLE_ID: '1566494998482911426',
    ADDITIONAL_ROLE_ID: '1566494998482911429',
    JOIN_ROLE_ID: '1566494998482911428',
    STAFF_ROLE_ID: '1566494998629711975',
    LOG_CHANNEL_ID: '1566495000194187513'
};

const TICKETS = {
    MAX_OPEN_PER_USER: 1,
    TRANSCRIPT_CHANNEL_ID: '1566495000403906632',
    CATEGORIES: [
        {
            key: 'support',
            label: 'Support',
            description: 'Contact the support team for general assistance.',
            emoji: '📫',
            parentId: null, // put a Discord category ID here to group ticket channels
            // IDs MUST be strings. As a number this ID loses digits and stops matching.
            roleIds: ['1566494998583844945']
        },
        {
            key: 'highrank',
            label: 'High Rank',
            description: 'Contact the High Command team.',
            emoji: '📫',
            parentId: null,
            roleIds: ['1566494998617268277']
        }
    ]
};

const BANNER_URL =
    'https://cdn.discordapp.com/attachments/1566504086583509206/1566518164995702945/Improved_Document_Design_-_2.png?ex=6ae8d53b&is=6ae783bb&hm=576d4565dbc9f5dc7f59a1c07e556e0f237cd3c168eab096e97fcde92946c841&';

const BANNERS = {
    VERIFY: BANNER_URL,
    TICKET: BANNER_URL
};

const BRAND_COLOR = 0x1D4F91;
const BULLET = '<a:Bullet:1561941326952398928>';
const CLOCK = '<:Clock:1561940562993614919>';

const isSet = value =>
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('PUT_');

const sleepDelete = (message, ms = 6000) => {
    setTimeout(() => message.delete().catch(() => {}), ms);
};

const closing = new Set(); // ticket channels currently being closed

// ============================================================
// COMPONENTS V2 BUILDERS
// ============================================================

function makeContainer(color = BRAND_COLOR) {
    return new ContainerBuilder().setAccentColor(color);
}

function addText(container, content) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
    );
    return container;
}

function addDivider(container, spacing = SeparatorSpacingSize.Small) {
    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(spacing).setDivider(true)
    );
    return container;
}

function addBannerTop(container, url = BANNERS.TICKET) {
    if (url) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(url)
            )
        );
        addDivider(container);
    }
    return container;
}

function v2(content, color = BRAND_COLOR) {
    const container = makeContainer(color);
    addText(container, content);
    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
}

function ephemeral(content, color = BRAND_COLOR) {
    const container = makeContainer(color);
    addText(container, content);
    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };
}

async function sendLog(guild, content) {
    if (!isSet(CONFIG.LOG_CHANNEL_ID)) return;

    const channel =
        guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID) ??
        await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);

    if (!channel?.isTextBased() || !channel.send) return;

    try {
        await channel.send(v2(content));
    } catch (error) {
        console.error('Log send failed:', error);
    }
}

function toEmoji(value) {
    if (!value || typeof value !== 'string') return null;

    const custom = value.trim().match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
    if (custom) {
        return {
            animated: custom[1] === 'a',
            name: custom[2],
            id: custom[3]
        };
    }

    if (/[^\x00-\x7F]/.test(value)) {
        return { name: value.trim() };
    }

    return null;
}

// ============================================================
// ROBLOX LOOKUP
// ============================================================

async function getRobloxUser(username) {
    try {
        const response = await fetch(
            'https://users.roblox.com/v1/usernames/users',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usernames: [username],
                    excludeBannedUsers: false
                }),
                signal: AbortSignal.timeout(10000)
            }
        );

        if (!response.ok) return null;

        const data = await response.json();
        if (!data.data?.length) return null;

        const user = data.data[0];

        const profileResponse = await fetch(
            `https://users.roblox.com/v1/users/${user.id}`,
            { signal: AbortSignal.timeout(10000) }
        );

        if (!profileResponse.ok) return null;

        const profile = await profileResponse.json();

        return {
            id: profile.id,
            name: profile.name,
            displayName: profile.displayName,
            created: profile.created
        };
    } catch (error) {
        console.error('Roblox API error:', error);
        return null;
    }
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function hasStaffRole(member) {
    return Boolean(member?.roles?.cache?.has(CONFIG.STAFF_ROLE_ID));
}

function categoryByKey(key) {
    return TICKETS.CATEGORIES.find(category => category.key === key);
}

function ticketRoleIds(guild, category) {
    const ids = (category?.roleIds ?? [])
        .filter(id => isSet(id) && guild.roles.cache.has(id));

    if (ids.length) return [...new Set(ids)];

    return guild.roles.cache.has(CONFIG.STAFF_ROLE_ID)
        ? [CONFIG.STAFF_ROLE_ID]
        : [];
}

function parseTicket(channel) {
    if (!channel?.topic?.startsWith('ticket:')) return null;

    const [openerId, typeKey, created] =
        channel.topic.slice(7).split('|');

    if (!openerId || !typeKey) return null;

    return {
        openerId,
        typeKey,
        created: Number(created) || Math.floor(Date.now() / 1000)
    };
}

function isTicketStaff(member, info) {
    if (!member || !info) return false;

    if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
        return true;
    }

    return ticketRoleIds(
        member.guild,
        categoryByKey(info.typeKey)
    ).some(id => member.roles.cache.has(id));
}

function findOpenTickets(guild, userId) {
    return guild.channels.cache.filter(channel =>
        parseTicket(channel)?.openerId === userId
    );
}

function getTranscriptChannel(guild) {
    const id = isSet(TICKETS.TRANSCRIPT_CHANNEL_ID)
        ? TICKETS.TRANSCRIPT_CHANNEL_ID
        : CONFIG.LOG_CHANNEL_ID;

    return isSet(id)
        ? guild.channels.cache.get(id) ?? null
        : null;
}

function componentText(components) {
    const output = [];

    for (const component of components ?? []) {
        const content = component.content ?? component.data?.content;
        if (typeof content === 'string') output.push(content);

        if (component.components?.length) {
            output.push(componentText(component.components));
        }
    }

    return output.filter(Boolean).join('\n');
}

async function getWelcomeMessage(channel) {
    const messages = await channel.messages.fetch({
        after: '0',
        limit: 10
    }).catch(() => null);

    if (!messages) return null;

    return messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .find(message =>
            message.author.id === client.user.id &&
            message.components?.length
        ) ?? null;
}

function claimerFromMessage(message) {
    const text = componentText(message?.components);
    const match = text.match(/Claimed By:\*\*\s*<@!?(\d+)>/i);
    return match ? match[1] : null;
}

// Updates the ticket's control card in place: fills in "Claimed By" and disables the
// Claim button. It edits the card's own data, so the banner, dividers and the
// Close/Transcript buttons are all kept.
function claimedCardJson(message, claimerId) {
    const json = message.components[0].toJSON();

    for (const item of json.components ?? []) {
        if (item.type === ComponentType.TextDisplay && typeof item.content === 'string') {
            item.content = item.content.replace(
                /\*\*Claimed By:\*\*\s*(?:<@!?\d+>|Unclaimed)/i,
                `**Claimed By:** <@${claimerId}>`
            );
        }

        if (item.type === ComponentType.ActionRow) {
            for (const button of item.components ?? []) {
                if (button.custom_id === 'ticket_claim') {
                    button.disabled = true;
                    button.label = 'Claimed';
                }
            }
        }
    }

    return {
        components: [json],
        flags: MessageFlags.IsComponentsV2
    };
}

async function notice(message, content, color = BRAND_COLOR, ms = 6000) {
    const sent = await message.reply(v2(content, color)).catch(() => null);
    if (sent) sleepDelete(sent, ms);
    return sent;
}

function safeChannelName(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'ticket';
}

// ============================================================
// TICKET PANEL
// ============================================================

function ticketPanelPayload() {
    const container = makeContainer();
    addBannerTop(container, BANNERS.TICKET);

    addText(
        container,
        '# Baltimore Police Department | Support Center\n' +
        'Welcome to the **Baltimore Police Department Support Center**.\n' +
        'Select the department below that best matches your request. A private ticket will be created for you.'
    );

    addDivider(container);

    addText(
        container,
        '### Available Departments\n' +
        `${BULLET} **General Support** — Questions, assistance, and general concerns.\n` +
        `${BULLET} **High Command** — Matters that require attention from High Command.\n\n` +
        '-# Please provide accurate information and remain respectful while communicating with staff.'
    );

    const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket_category')
        .setPlaceholder('Select a department')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            TICKETS.CATEGORIES.map(category => {
                const option = new StringSelectMenuOptionBuilder()
                    .setLabel(category.label)
                    .setDescription(category.description.slice(0, 100))
                    .setValue(category.key);

                // setEmoji(undefined) throws, so only set it when the emoji is valid
                const emoji = toEmoji(category.emoji);
                if (emoji) option.setEmoji(emoji);

                return option;
            })
        );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(menu)
    );

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2
    };
}

// ============================================================
// CREATE TICKET
// ============================================================

async function createTicket(interaction, category) {
    const guild = interaction.guild;
    const user = interaction.user;

    // Defer first: creating a channel can take longer than Discord's 3-second limit
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Re-send the panel so the dropdown doesn't stay stuck on the chosen option
    interaction.message?.edit(ticketPanelPayload()).catch(() => {});

    const fail = text => interaction.editReply(v2(text, 0xED4245));

    if (!category) {
        return fail('That ticket department is not configured.');
    }

    const existing = findOpenTickets(guild, user.id);

    if (existing.size >= TICKETS.MAX_OPEN_PER_USER) {
        return interaction.editReply(
            v2(`You already have an open ticket: <#${existing.first().id}>`)
        );
    }

    const parent = category.parentId
        ? guild.channels.cache.get(category.parentId) ??
          await guild.channels.fetch(category.parentId).catch(() => null)
        : null;

    if (category.parentId && (!parent || parent.type !== ChannelType.GuildCategory)) {
        return fail('The ticket category is missing or is not a category channel.');
    }

    const staffIds = ticketRoleIds(guild, category);
    const channelPerms = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
    ];

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: user.id,
            type: OverwriteType.Member,
            allow: channelPerms
        },
        {
            id: client.user.id,
            type: OverwriteType.Member,
            allow: [
                ...channelPerms,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        },
        ...staffIds.map(id => ({
            id,
            type: OverwriteType.Role,
            allow: channelPerms
        }))
    ];

    const created = Math.floor(Date.now() / 1000);
    const channelName = safeChannelName(
        `${category.key}-${user.username}`
    );

    let channel;

    try {
        channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: parent?.id ?? undefined,
            topic: `ticket:${user.id}|${category.key}|${created}`,
            permissionOverwrites,
            reason: `Support ticket opened by ${user.tag}`
        });
    } catch (error) {
        console.error('Ticket channel creation failed:', error);
        return fail('I could not create your ticket. Please contact staff.');
    }

    const staffPings = staffIds.map(id => `<@&${id}>`).join(' ');

    const container = makeContainer();
    addBannerTop(container, BANNERS.TICKET);

    // Components V2 messages cannot use `content`, so the pings live inside the card
    addText(
        container,
        '# Baltimore Police Department | Ticket Opened\n' +
        (staffPings ? `${staffPings}\n\n` : '') +
        `Welcome, <@${user.id}>. Your **${category.label}** ticket has been created.\n\n` +
        `**Ticket Owner:** <@${user.id}>\n` +
        `**Department:** ${category.label}\n` +
        `**Claimed By:** Unclaimed\n` +
        `**Opened:** <t:${created}:F>\n\n` +
        'Please explain your concern below. A staff member will assist you as soon as possible.'
    );

    addDivider(container);

    addText(
        container,
        '-# Do not ping staff repeatedly. Please keep all information relevant to this ticket.'
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_claim')
                .setLabel('Claim Ticket')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket_transcript')
                .setLabel('Transcript')
                .setStyle(ButtonStyle.Secondary)
        )
    );

    try {
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { roles: staffIds, users: [user.id] }
        });
    } catch (error) {
        console.error('Ticket welcome message failed:', error);
        await channel.delete('Ticket setup failed').catch(() => {});
        return fail('The ticket could not be set up. Please try again.');
    }

    await interaction.editReply(
        v2(`# Ticket Created\nYour ticket has been created: <#${channel.id}>`)
    );

    await sendLog(
        guild,
        '# Ticket Created\n' +
        `**Ticket:** <#${channel.id}>\n` +
        `**Owner:** <@${user.id}> (\`${user.id}\`)\n` +
        `**Department:** ${category.label}\n` +
        `**Created:** <t:${created}:F>`
    );
}

// ============================================================
// TRANSCRIPTS
// ============================================================

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Downloads an image and returns it as a data: URI so it never expires inside the transcript
async function toDataUri(url, contentType) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
        return null;
    }
}

// `budget.left` = how many bytes of images we may still embed in this transcript
async function formatMessageHtml(message, budget) {
    const timestamp = new Date(message.createdTimestamp).toLocaleString();
    const author = escapeHtml(
        `${message.author?.tag ?? 'Unknown User'} (${message.author?.id ?? 'unknown'})`
    );

    // Bot cards (Components V2) have no `content`, so read their text components instead
    const content = escapeHtml(message.content || componentText(message.components) || '');

    let attachments = '';

    for (const file of message.attachments.values()) {
        const name = escapeHtml(file.name ?? 'Attachment');
        const url = escapeHtml(file.url);

        if (file.contentType?.startsWith('image/')) {
            let source = file.url;

            // Embed images up to 1.5 MB each (6 MB total); bigger ones stay as links
            if (file.size <= 1.5 * 1024 * 1024 && budget.left >= file.size) {
                const data = await toDataUri(file.url, file.contentType);

                if (data) {
                    source = data;
                    budget.left -= file.size;
                }
            }

            attachments +=
                `<div class="attachment"><a href="${url}"><img class="att" src="${escapeHtml(source)}" alt="${name}"></a></div>`;
        } else {
            attachments +=
                `<div class="attachment"><a href="${url}">${name}</a> (${(file.size / 1024).toFixed(1)} KB)</div>`;
        }
    }

    const embeds = message.embeds?.length
        ? `<div class="embed">[${message.embeds.length} embed(s)]</div>`
        : '';

    return `
      <article class="message">
        <div class="meta"><strong>${author}</strong><time>${escapeHtml(timestamp)}</time></div>
        <div class="content">${content || '<em>No text content</em>'}</div>
        ${attachments}
        ${embeds}
      </article>
    `;
}

async function fetchAllMessages(channel) {
    const all = [];
    let before;

    while (true) {
        const batch = await channel.messages.fetch({
            limit: 100,
            ...(before ? { before } : {})
        });

        if (!batch.size) break;

        all.push(...batch.values());
        before = batch.last().id;

        if (batch.size < 100) break;
    }

    return all.sort((a, b) =>
        a.createdTimestamp - b.createdTimestamp
    );
}

async function createTranscript(channel) {
    const messages = await fetchAllMessages(channel);

    const budget = { left: 6 * 1024 * 1024 };
    const rows = [];
    for (const message of messages) {
        rows.push(await formatMessageHtml(message, budget));
    }

    const ticket = parseTicket(channel);
    const owner = ticket?.openerId ?? 'Unknown';
    const category = categoryByKey(ticket?.typeKey)?.label ?? 'Unknown';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket Transcript - ${escapeHtml(channel.name)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:30px;background:#0b1220;color:#e5e7eb;font-family:Arial,sans-serif}
main{max-width:1000px;margin:auto;background:#111c30;border:1px solid #26344d;border-radius:12px;overflow:hidden}
header{padding:24px;background:#142a49;border-bottom:1px solid #26344d}
h1{margin:0 0 12px;font-size:24px}
.info{color:#b9c7da;font-size:14px;line-height:1.8}
.messages{padding:20px}
.message{padding:14px 0;border-bottom:1px solid #26344d}
.meta{display:flex;justify-content:space-between;gap:15px;color:#9fb2ca;font-size:13px}
.meta strong{color:#fff}
.content{padding-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
.attachment,.embed{padding-top:8px;font-size:13px}
.att{max-width:420px;max-height:320px;border-radius:6px;display:block}
a{color:#7db8ff}
footer{padding:16px 24px;color:#8194ae;font-size:12px;border-top:1px solid #26344d}
</style>
</head>
<body>
<main>
<header>
<h1>Baltimore Police Department — Ticket Transcript</h1>
<div class="info">
Channel: #${escapeHtml(channel.name)}<br>
Ticket Owner: ${escapeHtml(owner)}<br>
Department: ${escapeHtml(category)}<br>
Generated: ${escapeHtml(new Date().toLocaleString())}<br>
Messages: ${messages.length}
</div>
</header>
<section class="messages">
${rows.join('\n')}
</section>
<footer>Generated by the Baltimore Police Department bot.</footer>
</main>
</body>
</html>`;

    return Buffer.from(html, 'utf8');
}

async function sendTranscript(channel, requestedBy, existingBuffer = null) {
    const target = getTranscriptChannel(channel.guild);

    if (!target || !target.isTextBased()) {
        throw new Error('Transcript channel is not available.');
    }

    const buffer = existingBuffer ?? await createTranscript(channel);
    const attachment = new AttachmentBuilder(buffer, {
        name: `${channel.name}-transcript.html`
    });

    // In a Components V2 message the file has to be referenced by a File component
    const card = makeContainer();
    addText(
        card,
        '# Ticket Transcript\n' +
        `**Ticket:** #${channel.name}\n` +
        `**Requested By:** <@${requestedBy.id}>\n` +
        `**Generated:** <t:${Math.floor(Date.now() / 1000)}:F>`
    );
    card.addFileComponents(
        new FileBuilder().setURL(`attachment://${attachment.name}`)
    );

    await target.send({
        components: [card],
        files: [attachment],
        flags: MessageFlags.IsComponentsV2
    });

    return target;
}

// ============================================================
// CLOSE TICKET
// ============================================================

async function closeTicket(channel, closedBy, reason = 'No reason provided') {
    const info = parseTicket(channel);

    if (!info) {
        throw new Error('This is not a ticket channel.');
    }

    if (closing.has(channel.id)) {
        throw new Error('This ticket is already being closed.');
    }

    closing.add(channel.id);

    try {
        const guild = channel.guild;
        const owner = await guild.members.fetch(info.openerId).catch(() => null);
        const claimedId = claimerFromMessage(await getWelcomeMessage(channel));

        // Build the transcript once; it is reused for the log channel and the DM
        const buffer = await createTranscript(channel);

        // If the transcript can't be saved this throws, and the ticket is NOT deleted
        await sendTranscript(channel, closedBy, buffer);

        await sendLog(
            guild,
            '# Ticket Closed\n' +
            `**Ticket:** #${channel.name}\n` +
            `**Owner:** <@${info.openerId}>\n` +
            `**Claimed By:** ${claimedId ? `<@${claimedId}>` : 'Unclaimed'}\n` +
            `**Closed By:** <@${closedBy.id}>\n` +
            `**Reason:** ${reason}\n` +
            `**Closed:** <t:${Math.floor(Date.now() / 1000)}:F>`
        );

        if (owner) {
            // 1) a copy of the transcript
            const dmSent = await owner.send({
                content:
                    `Here is a copy of the transcript for **#${channel.name}**. ` +
                    'Download it and open it in a web browser.',
                files: [
                    new AttachmentBuilder(buffer, { name: `${channel.name}-transcript.html` })
                ]
            }).then(() => true).catch(() => false);

            // 2) the closing card with the star rating
            if (dmSent) {
                const rateRow = new ActionRowBuilder().addComponents(
                    [1, 2, 3, 4, 5].map(n =>
                        new ButtonBuilder()
                            .setCustomId(
                                `ticket_rate:${guild.id}:${n}:${claimedId ?? 0}:${channel.name.slice(0, 30)}`
                            )
                            .setLabel(String(n))
                            .setEmoji({ name: '⭐' })
                            .setStyle(ButtonStyle.Secondary)
                    )
                );

                const dm = makeContainer();
                addBannerTop(dm, BANNERS.TICKET);

                addText(
                    dm,
                    '# Your Ticket Has Been Closed\n' +
                    `Your ticket in **Baltimore Police Department** has been closed.\n\n` +
                    `**Ticket:** #${channel.name}\n` +
                    `**Reason:** ${reason}\n\n` +
                    'If you still need assistance, you may open another ticket.'
                );

                addDivider(dm);

                addText(dm, '### How was your support experience?\nRate it below:');
                dm.addActionRowComponents(rateRow);

                await owner.send({
                    components: [dm],
                    flags: MessageFlags.IsComponentsV2
                }).catch(() => {});
            }
        }

        const closedContainer = makeContainer(0xED4245);

        addText(
            closedContainer,
            '# Ticket Closed\n' +
            `This ticket was closed by <@${closedBy.id}>.\n\n` +
            `**Reason:** ${reason}\n` +
            '-# This channel will be deleted in a few seconds.'
        );

        await channel.send({
            components: [closedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        await new Promise(resolve => setTimeout(resolve, 5000));

        await channel.delete(`Ticket closed by ${closedBy.tag}: ${reason}`);
    } catch (error) {
        closing.delete(channel.id);
        throw error;
    }
}

// Removes the rating buttons from the DM card and shows a thank-you line instead
function closedCardJson(message, status) {
    const json = message.components[0].toJSON();

    json.components = (json.components ?? []).filter(
        item => item.type !== ComponentType.ActionRow
    );

    json.components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    json.components.push({ type: ComponentType.TextDisplay, content: status });

    return {
        components: [json],
        flags: MessageFlags.IsComponentsV2
    };
}

// Star rating buttons sent in the DM after a ticket is closed (these work in DMs)
async function handleRating(interaction) {
    const [, guildId, rating, claimedId, name] = interaction.customId.split(':');
    const stars = '⭐'.repeat(Number(rating) || 0);

    await interaction.update(
        closedCardJson(
            interaction.message,
            `**Thanks for your feedback!** You rated your experience **${rating}/5** ${stars}`
        )
    );

    const guild = client.guilds.cache.get(guildId);
    const target = guild ? getTranscriptChannel(guild) : null;

    if (!target?.isTextBased() || !target.send) return;

    await target.send(
        v2(
            '# Ticket Rating\n' +
            `${BULLET} **Ticket:** \`#${name}\`\n` +
            `${BULLET} **Rating:** ${stars} (${rating}/5)\n` +
            `${BULLET} **Handled By:** ${claimedId && claimedId !== '0' ? `<@${claimedId}>` : 'Unclaimed'}\n` +
            `${BULLET} **From:** ${interaction.user.tag} (<@${interaction.user.id}>)`
        )
    ).catch(() => {});
}

// ============================================================
// TICKET BUTTON INTERACTIONS
// ============================================================

async function handleTicketButton(interaction) {
    const channel = interaction.channel;
    const info = parseTicket(channel);

    if (!info) {
        return interaction.reply(
            ephemeral('This ticket is no longer valid.', 0xED4245)
        );
    }

    if (interaction.customId === 'ticket_claim') {
        if (!isTicketStaff(interaction.member, info)) {
            return interaction.reply(
                ephemeral('You do not have permission to claim this ticket.', 0xED4245)
            );
        }

        const welcome = await getWelcomeMessage(channel);
        if (!welcome) {
            return interaction.reply(
                ephemeral('I could not find the ticket control message.', 0xED4245)
            );
        }

        const existingClaimer = claimerFromMessage(welcome);

        if (existingClaimer) {
            return interaction.reply(
                ephemeral(`This ticket has already been claimed by <@${existingClaimer}>.`)
            );
        }

        await welcome.edit(claimedCardJson(welcome, interaction.user.id));

        await interaction.reply(
            ephemeral('You have successfully claimed this ticket.')
        );

        await sendLog(
            interaction.guild,
            '# Ticket Claimed\n' +
            `**Ticket:** <#${channel.id}>\n` +
            `**Claimed By:** <@${interaction.user.id}>`
        );

        return;
    }

    if (
        ['ticket_close', 'ticket_close_confirm', 'ticket_close_cancel']
            .includes(interaction.customId)
    ) {
        const canClose =
            interaction.user.id === info.openerId ||
            isTicketStaff(interaction.member, info);

        if (!canClose) {
            return interaction.reply(
                ephemeral('Only the ticket owner or authorized staff can close this ticket.', 0xED4245)
            );
        }

        // Step 1: ask "are you sure?" (only the person who clicked sees this)
        if (interaction.customId === 'ticket_close') {
            const prompt = makeContainer(0xED4245);

            addText(
                prompt,
                '# Close Ticket\n' +
                'Are you sure you want to close this ticket? A transcript will be saved and this channel will be deleted.'
            );

            prompt.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_close_confirm')
                        .setLabel('Confirm Close')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('ticket_close_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                )
            );

            return interaction.reply({
                components: [prompt],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        // Cancel: leave the ticket open
        if (interaction.customId === 'ticket_close_cancel') {
            return interaction.update(v2('# Cancelled\nThe ticket stays open.'));
        }

        // Step 2: confirmed
        await interaction.update(v2('# Closing Ticket\nSaving the transcript…'));

        try {
            await closeTicket(channel, interaction.user);
            await interaction.editReply(
                v2('# Ticket Closed\nThe transcript was saved and the ticket has been closed.')
            ).catch(() => {});
        } catch (error) {
            console.error('Ticket close failed:', error);
            await interaction.editReply(
                v2(
                    '# Close Failed\nI could not close the ticket. Check that the transcript channel is configured and that I have permission to send files.',
                    0xED4245
                )
            ).catch(() => {});
        }

        return;
    }

    if (interaction.customId === 'ticket_transcript') {
        if (
            interaction.user.id !== info.openerId &&
            !isTicketStaff(interaction.member, info)
        ) {
            return interaction.reply(
                ephemeral('You do not have permission to generate this transcript.', 0xED4245)
            );
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            await sendTranscript(channel, interaction.user);
            await interaction.editReply(
                'The ticket transcript has been sent to the transcript channel.'
            );
        } catch (error) {
            console.error('Transcript generation failed:', error);
            await interaction.editReply(
                'I could not generate the transcript. Please contact staff.'
            );
        }
    }
}

// ============================================================
// TICKET SLASH COMMANDS
// ============================================================

const ticketCommand = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage Baltimore Police Department support tickets')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a member to this ticket')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Member to add')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a member from this ticket')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Member to remove')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('rename')
            .setDescription('Rename this ticket')
            .addStringOption(option =>
                option
                    .setName('name')
                    .setDescription('New channel name')
                    .setRequired(true)
                    .setMaxLength(90)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('claim')
            .setDescription('Claim this ticket')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('close')
            .setDescription('Close this ticket')
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Reason for closing')
                    .setRequired(false)
                    .setMaxLength(500)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('transcript')
            .setDescription('Generate this ticket transcript')
    );

async function handleTicketCommand(interaction) {
    const channel = interaction.channel;
    const info = parseTicket(channel);

    if (!info) {
        return interaction.reply(
            ephemeral('This command can only be used inside a ticket channel.', 0xED4245)
        );
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add' || subcommand === 'remove') {
        if (!isTicketStaff(interaction.member, info)) {
            return interaction.reply(
                ephemeral('You do not have permission to manage ticket members.', 0xED4245)
            );
        }

        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            return interaction.reply(
                ephemeral('That member is not in this server.', 0xED4245)
            );
        }

        try {
            if (subcommand === 'add') {
                await channel.permissionOverwrites.edit(member.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true
                });

                await interaction.reply(
                    ephemeral(`<@${member.id}> has been added to this ticket.`)
                );

                await channel.send(
                    v2(`**Member Added:** <@${member.id}>\n**Added By:** <@${interaction.user.id}>`)
                );
            } else {
                if (member.id === info.openerId) {
                    return interaction.reply(
                        ephemeral('You cannot remove the ticket owner.', 0xED4245)
                    );
                }

                await channel.permissionOverwrites.delete(member.id);

                await interaction.reply(
                    ephemeral(`<@${member.id}> has been removed from this ticket.`)
                );

                await channel.send(
                    v2(`**Member Removed:** <@${member.id}>\n**Removed By:** <@${interaction.user.id}>`)
                );
            }
        } catch (error) {
            console.error('Ticket member management failed:', error);

            if (!interaction.replied) {
                await interaction.reply(
                    ephemeral('I could not update this ticket member.', 0xED4245)
                );
            }
        }

        return;
    }

    if (subcommand === 'rename') {
        if (!isTicketStaff(interaction.member, info)) {
            return interaction.reply(
                ephemeral('You do not have permission to rename this ticket.', 0xED4245)
            );
        }

        const name = safeChannelName(
            interaction.options.getString('name', true)
        );

        // Defer first: Discord rate-limits renames and the call can be slow
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await channel.setName(name);
            await interaction.editReply(v2(`Ticket renamed to **${name}**.`));
        } catch (error) {
            console.error('Ticket rename failed:', error);
            await interaction.editReply(
                v2('I could not rename this ticket. Discord only allows 2 renames per 10 minutes.', 0xED4245)
            );
        }

        return;
    }

    if (subcommand === 'claim') {
        if (!isTicketStaff(interaction.member, info)) {
            return interaction.reply(
                ephemeral('You do not have permission to claim this ticket.', 0xED4245)
            );
        }

        const welcome = await getWelcomeMessage(channel);

        if (!welcome) {
            return interaction.reply(
                ephemeral('I could not find the ticket control message.', 0xED4245)
            );
        }

        const existingClaimer = claimerFromMessage(welcome);

        if (existingClaimer) {
            return interaction.reply(
                ephemeral(`This ticket is already claimed by <@${existingClaimer}>.`)
            );
        }

        await welcome.edit(claimedCardJson(welcome, interaction.user.id));

        await interaction.reply(
            ephemeral('You have claimed this ticket.')
        );

        return;
    }

    if (subcommand === 'transcript') {
        if (
            interaction.user.id !== info.openerId &&
            !isTicketStaff(interaction.member, info)
        ) {
            return interaction.reply(
                ephemeral('You do not have permission to generate this transcript.', 0xED4245)
            );
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            await sendTranscript(channel, interaction.user);
            await interaction.editReply('Transcript generated successfully.');
        } catch (error) {
            console.error('Transcript command failed:', error);
            await interaction.editReply('Transcript generation failed.');
        }

        return;
    }

    if (subcommand === 'close') {
        if (
            interaction.user.id !== info.openerId &&
            !isTicketStaff(interaction.member, info)
        ) {
            return interaction.reply(
                ephemeral('You do not have permission to close this ticket.', 0xED4245)
            );
        }

        const reason =
            interaction.options.getString('reason') || 'No reason provided';

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            await closeTicket(channel, interaction.user, reason);
            await interaction.editReply('Ticket closed successfully.');
        } catch (error) {
            console.error('Ticket slash close failed:', error);
            await interaction.editReply(
                'Ticket close failed. Check the transcript channel and bot permissions.'
            );
        }
    }
}

// ============================================================
// SAY COMMAND
// ============================================================

const SAY_USAGE =
    '# Say Command\n' +
    '`b!say <message>` — Send a message in this channel.\n' +
    '`b!say #channel <message>` — Send in another channel.\n' +
    '`b!say -e <message>` — Send as a Components V2 panel.\n' +
    '`b!say -r <messageId> <message>` — Reply to a message.\n\n' +
    'Flags can be combined, e.g. `b!say #announcements -e Hello!`\n' +
    'Attach files or images to your command message to include them. ' +
    'Panel mode (`-e`) supports images only.';

async function handleSay(message, raw) {
    let rest = raw.trim();

    // ── Parse flags from the start of the message (any order) ──
    const opts = { panel: false, replyId: null, channelId: null };

    for (;;) {
        let match;

        if ((match = rest.match(/^(?:-e|--embed)(?:\s+|$)/i))) {
            opts.panel = true;
        } else if ((match = rest.match(/^(?:-r|--reply)\s+(\d{17,20})(?:\s+|$)/i))) {
            opts.replyId = match[1];
        } else if ((match = rest.match(/^<#(\d{17,20})>(?:\s+|$)/))) {
            opts.channelId = match[1];
        } else {
            break;
        }

        rest = rest.slice(match[0].length);
    }

    const attachments = [...message.attachments.values()].slice(0, 10);

    if (!rest && attachments.length === 0) {
        return notice(message, SAY_USAGE, BRAND_COLOR, 20000);
    }

    // ── Resolve + validate the target channel ──
    const target = opts.channelId
        ? message.guild.channels.cache.get(opts.channelId) ??
          await message.guild.channels.fetch(opts.channelId).catch(() => null)
        : message.channel;

    if (!target || !target.isTextBased() || !target.send) {
        return notice(message, "# Invalid Channel\nI couldn't find that text channel.", 0xED4245);
    }

    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

    if (!target.permissionsFor(message.member)?.has(needed)) {
        return notice(message, "# No Permission\nYou can't send messages in that channel.", 0xED4245);
    }

    if (!target.permissionsFor(message.guild.members.me)?.has(needed)) {
        return notice(message, "# No Permission\nI can't send messages in that channel.", 0xED4245);
    }

    // ── Length limits ──
    const limit = opts.panel ? 4000 : 2000;

    if (rest.length > limit) {
        return notice(
            message,
            `# Message Too Long\nThat mode allows up to **${limit}** characters (yours: ${rest.length}).`,
            0xED4245
        );
    }

    // ── Optional reply target ──
    let replyTo = null;

    if (opts.replyId) {
        replyTo = await target.messages.fetch(opts.replyId).catch(() => null);

        if (!replyTo) {
            return notice(
                message,
                "# Message Not Found\nI couldn't find that message in the target channel.",
                0xED4245
            );
        }
    }

    // ── Mentions: @everyone/@here and role pings need the Mention Everyone permission ──
    const canMassPing = message.member.permissions.has(PermissionFlagsBits.MentionEveryone);
    const allowedMentions = {
        parse: canMassPing ? ['users', 'roles', 'everyone'] : ['users'],
        repliedUser: false
    };

    // ── Build the payload ──
    let payload;
    let skipped = 0;

    if (opts.panel) {
        const images = attachments.filter(file => file.contentType?.startsWith('image/'));
        skipped = attachments.length - images.length;

        const files = images.map((file, index) => {
            const extension =
                (file.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '') || 'png';

            return { attachment: file.url, name: `image${index + 1}.${extension}` };
        });

        const container = makeContainer();

        if (rest) addText(container, rest);

        if (files.length) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    ...files.map(file =>
                        new MediaGalleryItemBuilder().setURL(`attachment://${file.name}`)
                    )
                )
            );
        }

        payload = {
            components: [container],
            files,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions
        };
    } else {
        payload = {
            content: rest || undefined,
            files: attachments.map(file => ({ attachment: file.url, name: file.name })),
            allowedMentions
        };
    }

    // ── Send ──
    try {
        if (replyTo) await replyTo.reply(payload);
        else await target.send(payload);
    } catch (error) {
        console.error('Say command error:', error);
        return notice(message, '# Send Failed\nSomething went wrong sending that message.', 0xED4245);
    }

    await message.delete().catch(() => {});

    if (skipped > 0) {
        // The command message is gone, so post this as a normal message
        const sent = await message.channel.send(
            v2(`Panel mode only supports images — **${skipped}** other attachment(s) were skipped.`)
        ).catch(() => null);

        if (sent) sleepDelete(sent);
    }

    await sendLog(
        message.guild,
        '# Say Command Used\n' +
        `**By:** ${message.author.tag} (<@${message.author.id}>)\n` +
        `**Channel:** <#${target.id}>\n` +
        `**Mode:** ${opts.panel ? 'Panel' : 'Plain'}${replyTo ? ` — reply to \`${replyTo.id}\`` : ''}\n` +
        `**Message:**\n>>> ${rest.slice(0, 1000).replace(/`/g, "'") || '*[attachments only]*'}`
    );
}

// ============================================================
// INTERACTION ROUTER — TICKETS AND SLASH COMMANDS
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        // Rating buttons come from a DM, so handle them before any server-only checks
        if (interaction.isButton() && interaction.customId.startsWith('ticket_rate:')) {
            return await handleRating(interaction);
        }

        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket') {
                return await handleTicketCommand(interaction);
            }
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'ticket_category') {
                const category = categoryByKey(interaction.values[0]);
                return await createTicket(interaction, category);
            }
        }

        if (interaction.isButton()) {
            if (
                [
                    'ticket_claim', 'ticket_close', 'ticket_close_confirm',
                    'ticket_close_cancel', 'ticket_transcript'
                ].includes(interaction.customId)
            ) {
                return await handleTicketButton(interaction);
            }
        }
    } catch (error) {
        console.error('Interaction router error:', error);

        const response = ephemeral(
            'An unexpected error occurred. Please try again or contact staff.',
            0xED4245
        );

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(response).catch(() => {});
        } else {
            await interaction.reply(response).catch(() => {});
        }
    }
});

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

client.once(Events.ClientReady, async readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}`);

    const body = [ticketCommand.toJSON()];

    // Per-server registration shows up instantly (global commands can take a while)
    for (const guild of readyClient.guilds.cache.values()) {
        try {
            await guild.commands.set(body);
            console.log(`Slash commands registered in ${guild.name}`);
        } catch (error) {
            console.error(`Slash command registration failed in ${guild.name}:`, error);
        }
    }

    // Clear any leftover global copy so /ticket doesn't appear twice
    await readyClient.application.commands.set([]).catch(() => {});
});

// ============================================================
// PREFIX COMMAND ROUTER
// ============================================================

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const rawCommand = message.content.slice(PREFIX.length).trim();
    const split = rawCommand.match(/^(\S+)(?:\s+([\s\S]*))?$/);

    if (!split) return;

    const command = split[1].toLowerCase();

    if (!['sendverify', 'ticketpanel', 'say'].includes(command)) return;

    if (!hasStaffRole(message.member)) {
        const denied = await message.reply(
            v2(
                '# Access Denied\nOnly **Baltimore Police Department Staff** can use this command.',
                0xED4245
            )
        ).catch(() => null);

        if (denied) sleepDelete(denied, 5000);
        return;
    }

    if (command === 'say') {
        try {
            await handleSay(message, split[2] ?? '');
        } catch (error) {
            console.error('Say command error:', error);
            await notice(message, '# Error\nSomething went wrong while running this command.');
        }
        return;
    }

    if (command === 'ticketpanel') {
        try {
            await message.channel.send(ticketPanelPayload());
            await message.delete().catch(() => {});
        } catch (error) {
            console.error('Ticket panel send failed:', error);
            await notice(message, '# Panel Failed\nI could not send the ticket panel.');
        }
        return;
    }

    if (command === 'sendverify') {
        const container = makeContainer();
        addBannerTop(container, BANNERS.VERIFY);

        addText(
            container,
            '# Baltimore Police Department\n' +
            '**Verify your Roblox username to receive server access.**'
        );

        addDivider(container);

        addText(
            container,
            '### Requirements\n' +
            `${BULLET} You must have a valid Roblox account.\n` +
            `${BULLET} You must be at least 13 years old.\n` +
            `${BULLET} You must follow Baltimore Police Department rules.\n` +
            `${BULLET} One account per Discord account.\n\n` +
            '-# Note: Username lookup alone does not verify Roblox account ownership.'
        );

        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('start_verify')
                    .setLabel('Verify Now')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('verify_help')
                    .setLabel('Need Help?')
                    .setStyle(ButtonStyle.Secondary)
            )
        );

        try {
            await message.channel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            await message.delete().catch(() => {});
        } catch (error) {
            console.error('Verification panel send failed:', error);
            await notice(message, '# Panel Failed\nI could not send the verification panel.');
        }
    }
});

// ============================================================
// VERIFICATION INTERACTIONS
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction.isButton()) {
            if (
                !interaction.isModalSubmit() ||
                interaction.customId !== 'verify_modal'
            ) {
                return;
            }
        }

        if (!interaction.inGuild()) return;

        if (
            interaction.isButton() &&
            interaction.customId === 'start_verify'
        ) {
            // Use the member from the interaction itself: a modal must be shown within 3 seconds,
            // so we avoid an extra API fetch here
            if (interaction.member.roles.cache.has(CONFIG.VERIFIED_ROLE_ID)) {
                return interaction.reply(
                    ephemeral('You are already verified in the Baltimore Police Department server.')
                );
            }

            const modal = new ModalBuilder()
                .setCustomId('verify_modal')
                .setTitle('Baltimore Police Department Verification');

            const usernameInput = new TextInputBuilder()
                .setCustomId('roblox_username')
                .setLabel('Your Roblox Username')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter your exact Roblox username')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(20);

            modal.addComponents(
                new ActionRowBuilder().addComponents(usernameInput)
            );

            return interaction.showModal(modal);
        }

        if (
            interaction.isButton() &&
            interaction.customId === 'verify_help'
        ) {
            return interaction.reply(
                ephemeral(
                    '### Verification Help\n' +
                    '**1.** Enter your exact Roblox username, not your display name.\n' +
                    '**2.** If the account is not found, check for spelling errors.\n' +
                    '**3.** Contact a staff member if you still need assistance.'
                )
            );
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId === 'verify_modal'
        ) {
            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const username = interaction.fields
                .getTextInputValue('roblox_username')
                .trim();

            const robloxUser = await getRobloxUser(username);

            if (!robloxUser) {
                return interaction.editReply(
                    v2(
                        `# Roblox User Not Found\nNo Roblox account was found for **${username}**. Check the spelling and try again.`,
                        0xED4245
                    )
                );
            }

            const member = await interaction.guild.members.fetch(
                interaction.user.id
            );

            if (member.roles.cache.has(CONFIG.VERIFIED_ROLE_ID)) {
                return interaction.editReply(
                    v2('You are already verified.')
                );
            }

            try {
                await member.roles.add(
                    CONFIG.VERIFIED_ROLE_ID,
                    'Roblox username lookup completed'
                );

                if (isSet(CONFIG.ADDITIONAL_ROLE_ID)) {
                    await member.roles.add(CONFIG.ADDITIONAL_ROLE_ID);
                }

                if (isSet(CONFIG.JOIN_ROLE_ID)) {
                    await member.roles.remove(CONFIG.JOIN_ROLE_ID).catch(error => {
                        console.error('Join role removal failed:', error);
                    });
                }
            } catch (error) {
                console.error('Verification role assignment failed:', error);

                return interaction.editReply(
                    v2(
                        '# Role Assignment Failed\nI could not assign your roles. Please contact staff.',
                        0xED4245
                    )
                );
            }

            const createdDate = Math.floor(
                new Date(robloxUser.created).getTime() / 1000
            );

            const now = Math.floor(Date.now() / 1000);
            const success = makeContainer();

            addBannerTop(success, BANNERS.VERIFY);

            addText(
                success,
                '# Verification Successful!\n' +
                `Welcome to the **Baltimore Police Department**, **${robloxUser.displayName}**!\n\n` +
                `${BULLET} **Roblox Username:** \`@${robloxUser.name}\`\n` +
                `${BULLET} **Roblox ID:** \`${robloxUser.id}\`\n` +
                `${BULLET} **Account Created:** <t:${createdDate}:D>\n` +
                `${CLOCK} **Verified At:** <t:${now}:F>`
            );

            await interaction.editReply({
                components: [success],
                flags: MessageFlags.IsComponentsV2
            });

            await sendLog(
                interaction.guild,
                '# Member Verified\n' +
                `**Discord:** ${interaction.user.tag} (<@${interaction.user.id}>)\n` +
                `**Roblox:** ${robloxUser.displayName} (\`@${robloxUser.name}\`) — ID \`${robloxUser.id}\`\n` +
                `**Time:** <t:${now}:F>`
            );
        }
    } catch (error) {
        console.error('Verification interaction error:', error);

        const response = ephemeral(
            'Something went wrong during verification. Please contact staff.',
            0xED4245
        );

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(response).catch(() => {});
        } else {
            await interaction.reply(response).catch(() => {});
        }
    }
});

// ============================================================
// PROCESS ERRORS + LOGIN
// ============================================================

client.on(Events.Error, error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

if (!process.env.DISCORD_TOKEN) {
    console.error('Missing DISCORD_TOKEN environment variable.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
