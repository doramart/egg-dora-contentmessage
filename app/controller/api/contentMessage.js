const xss = require("xss");
const _ = require('lodash');
const shortid = require('shortid');
const {
    siteFunc,
} = require('../../utils');


let ContentMessageController = {

    renderMessage(ctx, userInfo = {}, messages = []) {

        return new Promise(async (resolve, reject) => {
            try {

                let newMessageArr = JSON.parse(JSON.stringify(messages));
                for (const messageItem of newMessageArr) {

                    let had_comment = false;
                    let had_despises = false;
                    let had_praise = false;
                    if (!_.isEmpty(userInfo)) {
                        // 是否回复过
                        let myReplyRecord = await ctx.service.message.find({
                            isPaging: '0'
                        }, {
                            query: {
                                author: userInfo._id,
                                relationMsgId: messageItem._id
                            }
                        });
                        if (myReplyRecord.length > 0) {
                            had_comment = true;
                        }
                        // 是否踩过
                        if (userInfo.despiseMessage.indexOf(messageItem._id) >= 0) {
                            had_despises = true;
                        }
                        // 是否赞过
                        if (userInfo.praiseMessages.indexOf(messageItem._id) >= 0) {
                            had_praise = true;
                        }
                    }
                    let praise_num = await ctx.service.user.count({
                        praiseMessages: messageItem._id
                    });
                    let despises_num = await ctx.service.user.count({
                        despiseMessage: messageItem._id
                    });
                    messageItem.praise_num = praise_num;
                    messageItem.despises_num = despises_num;
                    messageItem.had_comment = had_comment;
                    messageItem.had_despises = had_despises;
                    messageItem.had_praise = had_praise;

                    let parentId = messageItem._id;
                    let childMessages = await ctx.service.message.find({
                        pageSize: 5,
                        isPaging: '0'
                    }, {
                        query: {
                            relationMsgId: parentId
                        }
                    })
                    if (!_.isEmpty(childMessages)) {
                        messageItem.childMessages = childMessages;
                    } else {
                        messageItem.childMessages = [];
                    }
                    messageItem.comment_num = await ctx.service.message.count({
                        relationMsgId: parentId
                    })

                }

                resolve(newMessageArr);
            } catch (error) {
                resolve(messages);
            }
        })
    },



    async list(ctx, app) {

        try {

            let payload = ctx.query;
            let userId = ctx.query.userId;
            let contentId = ctx.query.contentId;
            let userInfo = ctx.session.user || {};
            let queryObj = {};

            if (userId) {
                queryObj.author = userId
            }

            if (contentId) {
                queryObj.contentId = contentId
            }

            let messageList = await ctx.service.message.find(payload, {
                query: queryObj
            });

            if (!_.isEmpty(userInfo)) {
                userInfo = await ctx.service.user.item(ctx, {
                    query: {
                        _id: userInfo._id
                    }
                })
            }

            messageList.docs = await this.renderMessage(ctx, userInfo, messageList.docs);

            ctx.helper.renderSuccess(ctx, {
                data: messageList
            });

        } catch (err) {

            ctx.helper.renderFail(ctx, {
                message: err
            });

        }
    },

    async postMessages(ctx, app) {


        try {

            let fields = ctx.request.body;

            let errMsg = '';
            if (_.isEmpty(ctx.session.user) && _.isEmpty(ctx.session.adminUserInfo)) {
                errMsg = ctx.__("validate_error_params")
            }
            if (!shortid.isValid(fields.contentId)) {
                errMsg = ctx.__("validate_message_add_err")
            }
            if (fields.content && (fields.content.length < 5 || fields.content.length > 200)) {
                errMsg = ctx.__("validate_rangelength", [ctx.__("label_messages_content"), 5, 200])
            }
            if (!fields.content) {
                errMsg = ctx.__("validate_inputNull", [ctx.__("label_messages_content")])
            }
            if (errMsg) {
                throw new Error(errMsg);
            }

            const messageObj = {
                contentId: fields.contentId,
                content: xss(fields.content),
                replyAuthor: fields.replyAuthor,
                author: ctx.session.user._id,
                relationMsgId: fields.relationMsgId,
                utype: fields.utype || '0',

            }

            let targetMessage = await ctx.service.message.create(messageObj);

            // 给被回复用户发送提醒邮件
            const systemConfigs = await ctx.service.systemConfig.find({
                isPaging: '0'
            });
            const contentInfo = await ctx.service.content.item(ctx, {
                query: {
                    _id: fields.contentId
                }
            })

            let replyAuthor;

            if (fields.replyAuthor) {
                replyAuthor = await UserModel.findOne({
                    _id: fields.replyAuthor
                }, getAuthUserFields())
                replyAuthor = await ctx.service.user.item(ctx, {
                    query: {
                        _id: fields.replyAuthor
                    },
                    files: getAuthUserFields()
                })
            }

            if (!_.isEmpty(systemConfigs) && !_.isEmpty(contentInfo) && !_.isEmpty(replyAuthor)) {
                let mailParams = {
                    replyAuthor: replyAuthor,
                    content: contentInfo,
                    author: ctx.session.user
                }
                ctx.helper.sendEmail(systemConfigs[0], emailTypeKey.email_notice_user_contentMsg, mailParams);
            }

            // 发送消息给客户端
            let passiveUser = fields.replyAuthor ? fields.replyAuthor : contentInfo.uAuthor;
            siteFunc.addSiteMessage('3', ctx.session.user, passiveUser, targetMessage._id, {
                targetMediaType: '1'
            });

            let returnMessage = await ctx.service.message.item(ctx, {
                query: {
                    _id: targetMessage._id
                }
            })

            ctx.helper.renderSuccess(ctx, {
                data: returnMessage
            });
        } catch (err) {

            ctx.helper.renderFail(ctx, {
                message: err
            });

        }

    }


}

module.exports = ContentMessageController;