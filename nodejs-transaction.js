'use strict';

const _map = require('lodash/map');
const _isEmpty = require('lodash/isEmpty');
const rp = require('request-promise-native');

const {
    UserNlu,
    UserProject,
    UserNluEntity,
    UserNluIntent,
    UserNluAction,
    UserNluVariable,
    sequelize
} = require('../data/models');
const {ErrorMessages} = require('./../constants');

const config = require('./../config');

class NluHandler {
    static async actionCreate(ctx) {
        const {project_id: id} = ctx.params;
        const {text, dialog_session_id, dialog_session_step_id, dialog_application_variable} = ctx.request.body;

        if(_isEmpty(text) && _isEmpty(dialog_session_id) && _isEmpty(dialog_session_step_id) && _isEmpty(dialog_application_variable)) {
            return ctx.badRequest(ErrorMessages.INVALID_REQUEST)
        }

        if (!await UserProject.count({where:{id}})) {
            return ctx.notFound(ErrorMessages.PROJECTS_NOT_FOUND)
        }

        const {success} = await rp({
            method: 'POST',
            uri: config.get('analyzeText'),
            body: {
                text,
                dialog_session_id,
                dialog_session_step_id,
                dialog_application_variable
            },
            json: true
        });

        if(_isEmpty(success)) {
            return ctx.badRequest(ErrorMessages.ENGINE_ERROR)
        }

        const userNlu = await sequelize.transaction(async transaction => {
            const nlu = await UserNlu.create({
                input_text: text,
                user_project_id: id,
                request_dialog_session_id: dialog_session_id,
                request_dialog_session_step_id: dialog_session_step_id,
                response_dialog_session_id: success['dialog_session_id'],
                response_dialog_session_step_id: success['dialog_session_step_id'],
            }, {transaction});

            const entities = await UserNluEntity.bulkCreate(
                _map(success.entities, entity => ({
                    entity_key: entity.entity_key,
                    entity_value: entity.entity_value,
                    entity_position_start: entity['entity_position'][0],
                    entity_position_end: entity['entity_position'][1],
                    user_nlu_id: nlu.id
                })),
                {validate: true, transaction});

            const intents = await UserNluIntent.bulkCreate(
                _map(success.intents, intent => ({
                    intent_value: intent.value,
                    confidence: intent.confidence,
                    user_nlu_id: nlu.id
                })),
                {validate: true, transaction});

            const dialog_actions = await UserNluAction.bulkCreate(
                _map(success['dialog_actions'], action => ({
                    action_key: action.action_key,
                    action_value: action.action_value,
                    user_nlu_id: nlu.id
                })),
                {validate: true, transaction});

            await UserNluVariable.bulkCreate(
                _map(dialog_application_variable, variable => ({
                    var_key: variable.var_key,
                    var_value: variable.var_value,
                    user_nlu_id: nlu.id
                })),
                {validate: true, transaction});

            return {
                entities,
                intents,
                dialog_session_id,
                dialog_session_step_id,
                dialog_actions
            }
        });

        return ctx.ok({userNlu})
    }

    static async actionIndex(ctx) {
        const {project_id: id} = ctx.params;

        const userNlu = await UserNlu.findAll({
            where: {user_project_id: id},
            include: [
                {
                    model: UserNluEntity,
                    as: 'entities',
                    attributes: ['entity_key', 'entity_value', 'entity_position_start', 'entity_position_end']
                },
                {
                    model: UserNluIntent,
                    as: 'intents',
                    attributes: [['intent_value', 'value'], 'confidence']
                },
                {
                    model: UserNluAction,
                    as: 'dialog_actions',
                    attributes: [['action_key', 'var_key'], 'action_value']
                },
                {
                    model: UserNluVariable,
                    as: 'dialog_application_variable'
                }
            ]
        });

        if (_isEmpty(userNlu)) {
            return ctx.notFound(ErrorMessages.NLU_NOT_FOUND)
        }

        return ctx.ok({categories: _map(userNlu, nlu => ({
                dialog_session_id: nlu.request_dialog_session_id,
                dialog_session_steps: [
                    {
                        request: {
                            text: nlu.input_text,
                            project_id: nlu.user_project_id,
                            dialog_session_id: nlu.request_dialog_session_id,
                            dialog_session_step_id: nlu.request_dialog_session_step_id,
                            dialog_application_variable: nlu.dialog_application_variable,
                        },
                        response: {
                            entities: nlu.entities,
                            intents: nlu.intents,
                            dialog_session_id: nlu.response_dialog_session_id,
                            dialog_session_step_id: nlu.response_dialog_session_step_id,
                            dialog_actions: nlu.dialog_actions
                        }
                    }
                ]
            }))})
    }
}

module.exports = NluHandler;
