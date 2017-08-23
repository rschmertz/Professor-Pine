"use strict";

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const settings = require('./../data/settings');

class Raid {
	constructor() {
		// channel maps of raid maps
		this.raids = new Map();

		// users map to last raid id for that user
		this.users = new Map();

		this.raids_counter = 0;

		this.roles = {
			mystic: '',
			valor: '',
			instinct: ''
		};

		// loop to clean up raids every 1 minute
		this.update = setInterval(() => {
			var now = moment();

			this.raids.forEach((raids_map, channel_id, channel_map) => {
				raids_map.forEach((raid, raid_id, raids_map) => {
					let end_time = new moment(raid.end_time, 'h:mm:ss a');
					let start_time = new moment(raid.start_time, 'h:mm:ss a');
					let completion_time = raid.default_end_time;

					// if end time exists, is valid, and is in the past, remove raid
					if (end_time.isValid() && now > end_time) {
						raids_map.delete(raid_id);
						return;
					}

					// if start time exists, is valid, and is in the past, remove raid
					if (start_time.isValid() && now > start_time) {
						raids_map.delete(raid_id);
						return;
					}

					// if start & end time do not exist, use creation time +X hours, to determine if raid should be removed
					if (!end_time.isValid() && !start_time.isValid() && now > completion_time) {
						raids_map.delete(raid_id);
						return;
					}
				});
			});
		}, 6000);
	}

	setUserRaidId(member, raid_id) {
		// TODO: displayName is just a nickname, anyone can change this at any time and we could even have duplicate nicknames.  Probably should be user id.
		this.users.set(member.displayName, raid_id);
	}

	createRaid(channel, member, raid_data) {
		let channel_raid_map = this.raids.get(channel.id);
		const id = raid_data.pokemon + '-' + this.raids_counter;

		// one time setup for getting role id's by name
		if (!this.roles.mystic) {
			this.roles.mystic = member.guild.roles.find('name', 'Mystic');
		}
		if (!this.roles.valor) {
			this.roles.valor = member.guild.roles.find('name', 'Valor');
		}
		if (!this.roles.instinct) {
			this.roles.instinct = member.guild.roles.find('name', 'Instinct');
		}

		// add extra data to "member"
		member.additional_attendees = 0;

		// add some extra raid data to remember
		raid_data.id = id;
		raid_data.creation_time = new moment();
		raid_data.default_end_time = (new moment()).add(settings.default_raid_length, 'milliseconds');
		raid_data.attendees = [member];

		if (channel_raid_map) {
			channel_raid_map.set(id, raid_data);
		} else {
			channel_raid_map = new Map();
			channel_raid_map.set(id, raid_data);
			this.raids.set(channel.id, channel_raid_map);
		}

		this.raids_counter++;

		this.setUserRaidId(member, id);

		return {raid: raid_data};
	}

	getRaid(channel, member, raid_id) {
		var channel = this.raids.get(channel.id);

		// if no channel exists, automatically fail out with undefind status
		if (!channel) {
			return;
		}

		// if a raid id doesn't exist, attempt to get the users' last interacted with raid
		if (!raid_id) {
			raid_id = this.users.get(member.displayName);
		}

		// returns a non-case senstive raid from map
		return this.raids.get(channel.id).get(raid_id.toLowerCase());
	}

	getAllRaids(channel, member) {
		return this.raids.get(channel.id);
	}

	findRaid(channel, member, args) {
		// take every argument given, and filter it down to only raids that exist
		const raids = args
			.map(arg => this.getRaid(channel, member, arg))
			.filter(raid => {
				return !!raid;
			});

		// get first raid in array of found raids
		let raid;
		if (raids.length > 0) {
			raid = raids[0];
		} else {
			// if raid could not be found (likely due to user entering garbage for the raid id),
			//		attempt to get raid from their last interacted with raid
			raid = this.getRaid(channel, member);
		}

		// strip out args that aren't active raids and send back
		const nonRaidArgs = args
			.filter(arg => {
				return !this.getRaid(channel, member, arg);
			});

		// if after all this, a raid still can not be found, return an error message
		if (!raid) {
			return {error: `<@${member.id}> No raid exists for ${args.join(' ')}.`}
		}

		return {raid: raid, args: nonRaidArgs};
	}

	getAttendeeCount(options) {
		let attendees = [];
		let length = 0;

		// get attendee data via given raid data, or map data in order to find the attendee data
		if (options.raid) {
			attendees = options.raid.attendees;
		} else {
			if (!options.channel || !options.member || isNaN(options.raid_id)) {
				throw ('Need raid data in order to get attendee count.');
			}
			attendees = this.getRaid(options.channel, options.member, options.raid_id).attendees;
		}

		length = attendees.length;

		for (let i = 0; i < attendees.length; i++) {
			const attendee = attendees[i];
			length += attendee.additional_attendees;
		}

		return length;
	}

	getMessage(channel, member, raid_id) {
		return this.getRaid(channel, member, raid_id).message;
	}

	setMessage(channel, member, raid_id, message) {
		this.getRaid(channel, member, raid_id).message = message;
	}

	addAttendee(channel, member, raid_id, additional_attendees = 0) {
		const raid_data = this.getRaid(channel, member, raid_id);
		let index;

		if (!raid_data) {
			return {error: `<@${member.id}> The raid you entered (${raid_id}) was not found.`}
		}

		// first check if member is already in list, and if they are, ignore their request to join again
		index = raid_data.attendees.findIndex(m => m.id === member.id);

		if (index >= 0) {
			return {error: `<@${member.id}> You\'ve already joined this raid.`}
		}

		// add some additional information to "member" joining the raid
		member.additional_attendees = additional_attendees;

		// message.member.displayName, message.guild
		raid_data.attendees.push(member);

		this.setUserRaidId(member, raid_id);

		return {raid: raid_data};
	}

	removeAttendee(channel, member, raid_id) {
		const raid_data = this.getRaid(channel, member, raid_id);

		// message.member.displayName, message.guild
		const index = raid_data.attendees.findIndex((m) => {
			return m.id === member.id;
		});

		raid_data.attendees.splice(index, 1);

		this.setUserRaidId(member, raid_id);

		return {raid: raid_data};
	}

	setArrivalStatus(channel, member, raid_id, status) {
		const raid_data = this.getRaid(channel, member, raid_id);

		for (let i = 0; i < raid_data.attendees.length; i++) {
			let m = raid_data.attendees[i];

			// TODO:  Can't set arrived status on member as it is on the MEMBER and thus will be set on other raids they attend
			//			need to save some where else, and need to save the main "author" as the raid leader for masterball status
			if (m.id === member.id) {
				m.has_arrived = status;
				break;
			}
		}

		this.setUserRaidId(member, raid_id);

		return {raid: raid_data};
	}

	setRaidTime(channel, member, raid_id, start_time) {
		const raid_data = this.getRaid(channel, member, raid_id);

		raid_data.start_time = start_time;

		this.setUserRaidId(member, raid_id);

		return {raid: raid_data};
	}

	setRaidLocation(channel, member, raid_id, gym) {
		const raid_data = this.getRaid(channel, member, raid_id);

		raid_data.gym = gym;

		this.setUserRaidId(member, raid_id);

		return {raid: raid_data};
	}


	getShortFormattedMessage(raids_map) {
		var raid_string = [];

		raids_map.forEach((raid, raid_id, raids_map) => {
			let pokemon = raid.pokemon.charAt(0).toUpperCase() + raid.pokemon.slice(1);
			let start_time = (raid.start_time) ? `starting at ${raid.start_time}` : 'start time to be announced';
			let total_attendees = this.getAttendeeCount({raid});
			let gym = (raid.gym) ? `Located at ${raid.gym}` : {gymName: ''};

			raid_string.push(`**__${pokemon}__**`);
			raid_string.push(`${raid_id} raid ${start_time}. ${total_attendees} potential trainer(s). ${gym.gymName}\n`);
		});

		return ' ' + raid_string.join('\n');
	}

	getFormattedMessage(raid_data) {
		const pokemon = raid_data.pokemon.charAt(0).toUpperCase() + raid_data.pokemon.slice(1);
		const end_time = (raid_data.end_time) ? raid_data.end_time : '????';
		const total_attendees = this.getAttendeeCount({raid: raid_data});
		const gym = (raid_data.gym) ? raid_data.gym : {gymName: '????'};

		const gym_name = gym.gymName;

		const location = gym_name !== '????' ?
			'https://www.google.com/maps/dir/Current+Location/' + gym.gymInfo.latitude + ',' + gym.gymInfo.longitude :
			undefined;

		// generate string of attendees
		let attendees_list = '';
		for (let i = 0; i < raid_data.attendees.length; i++) {
			let member = raid_data.attendees[i];

			// member list
			attendees_list += '';
			if (i === 0 && member.has_arrived) {
				attendees_list += '<:MasterBall:347218482078810112>';
			}
			else if (member.has_arrived) {
				attendees_list += '<:PokeBall:347218482296782849>';
			}
			else {
				attendees_list += '<:PremierBall:347221891263496193>';
			} //◻️, \t\t
			attendees_list += '  ' + member.displayName;

			// show how many additional attendees this user is bringing with them
			if (member.additional_attendees > 0) {
				attendees_list += ' +' + member.additional_attendees;
			}

			// add role emoji indicators if role exists
			if (this.roles.mystic && member.roles.has(this.roles.mystic.id)) {
				attendees_list += ' <:mystic:346183029171159041>';
			} else if (this.roles.valor && member.roles.has(this.roles.valor.id)) {
				attendees_list += ' <:valor:346182738652561408>';
			} else if (this.roles.instinct && member.roles.has(this.roles.instinct.id)) {
				attendees_list += ' <:instinct:346182737566105600>';
			}

			attendees_list += '\n';
		}

		return {
			"embed": {
				"title": `Level 5 Raid against ${pokemon}`,
				"description": `Raid available until ${end_time}\n` +
				`Location **${gym_name}**\n\n` +
				`Join this raid by typing the command \`\`\`!join ${raid_data.id}\`\`\`\n\n` +
				`Potential Trainers:\n` +
				`${attendees_list}\n` +
				`Trainers: **${total_attendees} total**\n` +
				`Starting @ **${((raid_data.start_time) ? (raid_data.start_time) : '????')}**\n`,
				"url": (location) ? location : 'https://discordapp.com',
				"color": 4437377,
				"thumbnail": {
					"url": "https://rankedboost.com/wp-content/plugins/ice/pokemon-go/" + pokemon + "-Pokemon-Go.png"
				},
				// "author": {
				// 	"name": "author name",
				// 	"url": "https://discordapp.com",
				// 	"icon_url": "https://cdn.discordapp.com/embed/avatars/0.png"
				// },
				// "fields": [
				// 	{
				// 		"name": raid_data.attendees.length + " will be attending @ " + ((raid_data.start_time)? (raid_data.start_time): '????'),
				// 		"value": attendees_list
				// 	}
				// ],
				// "footer": {
				// 	"text": (raid_data.start_time)? "Raid Begining @ " + raid_data.start_time: "Still determining a start time..."
				// }
			}
		};
	}
}

module.exports = new Raid();