// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, ActivityTypes } = require('botbuilder');

class RootBot extends ActivityHandler {
    constructor(conversationState, skillsConfig, skillClient) {
        super();
        if (!conversationState) throw new Error('[RootBot]: Missing parameter. conversationState is required');
        if (!skillsConfig) throw new Error('[RootBot]: Missing parameter. skillsConfig is required');
        if (!skillClient) throw new Error('[RootBot]: Missing parameter. skillClient is required');

        this.conversationState = conversationState;
        this.skillsConfig = skillsConfig;
        this.skillClient = skillClient;

        this.botId = process.env.MicrosoftAppId;
        if (!this.botId) {
            throw new Error('[RootBot] MicrosoftAppId is not set in configuration');
        }

        // We use a single skill in this example.
        const targetSkillId = 'EchoSkillBot';
        this.targetSkill = skillsConfig.skills[targetSkillId];
        if (!this.targetSkill) {
            throw new Error(`[RootBot] Skill with ID "${ targetSkillId }" not found in configuration`);
        }

        // Create state property to track the active skill
        this.activeSkillProperty = this.conversationState.createProperty(RootBot.ActiveSkillPropertyName);

        this.onTurn(async (turnContext, next) => {
            // Forward all activities except EndOfConversation to the active skill.
            if (turnContext.activity.type !== ActivityTypes.EndOfConversation) {
                // Try to get the active skill
                const activeSkill = await this.activeSkillProperty.get(turnContext);

                if (activeSkill) {
                    // Send the activity to the skill
                    await this.sendToSkill(turnContext, activeSkill);
                    return;
                }
            }

            // Ensure next BotHandler is executed.
            await next();
        });

        // See https://aka.ms/about-bot-activity-message to learn more about the message and other activity types.
        this.onMessage(async (context, next) => {
            if (context.activity.text.toLowerCase() === 'skill') {
                await context.sendActivity('Got it, connecting you to the skill...');

                // Set active skill
                await this.activeSkillProperty.set(context, this.targetSkill);

                // Send the activity to the skill
                await this.sendToSkill(context, this.targetSkill);
            } else {
                await context.sendActivity("Me no nothin'. Say 'skill' and I'll patch you through");
            }

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });

        this.onUnrecognizedActivityType(async (context, next) => {
            // Handle EndOfConversation returned by the skill.
            if (context.activity.type === ActivityTypes.EndOfConversation) {
                // Stop forwarding activities to Skill.
                await this.activeSkillProperty.set(context, undefined);

                // Show status message, text and value returned by the skill
                let eocActivityMessage = `Received ${ ActivityTypes.EndOfConversation }.\n\nCode: ${ context.activity.code }`;
                if (context.activity.text) {
                    eocActivityMessage += `\n\nText: ${ context.activity.text }`;
                }

                if (context.activity.value) {
                    eocActivityMessage += `\n\nValue: ${ context.activity.value }`;
                }

                await context.sendActivity(eocActivityMessage);

                // We are back at the root
                await context.sendActivity('Back in the root bot. Say \'skill\' and I\'ll patch you through');

                // Save conversation state
                await this.conversationState.saveChanges(context, true);
            }

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity('Hello and welcome!');
                }
            }

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }

    /**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     */
    async run(context) {
        await super.run(context);

        // Save any state changes. The load happened during the execution of the Dialog.
        await this.conversationState.saveChanges(context, false);
    }

    async sendToSkill(context, targetSkill) {
        // NOTE: Always SaveChanges() before calling a skill so that any activity generated by the skill
        // will have access to current accurate state.
        await this.conversationState.saveChanges(context, true);

        // route the activity to the skill
        const response = await this.skillClient.postToSkill(this.botId, targetSkill, this.skillsConfig.skillHostEndpoint, context.activity);

        // Check response status
        if (!(response.status >= 200 && response.status <= 299)) {
            throw new Error(`[RootBot]: Error invoking the skill id: "${ targetSkill.id }" at "${ targetSkill.skillEndpoint }" (status is ${ response.status }). \r\n ${ response.body }`);
        }
    }
}

module.exports.RootBot = RootBot;
RootBot.ActiveSkillPropertyName = 'activeSkillProperty';